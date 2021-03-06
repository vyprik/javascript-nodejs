// circular require BodyParser <- BbtagParser <- BodyParser
// when I require BodyParser it will get the unfinished export
// that's why I assign it here, before require('./bbtagParser')
module.exports = BodyParser;

var inherits = require('inherits');
var _ = require('lodash');
var assert = require('assert');
var StringSet = require('../util/stringSet');
var StringMap = require('../util/stringMap');
var Parser = require('./parser');
var BbtagParser = require('./bbtagParser');
var BodyLexer = require('./bodyLexer');
var LinkTag = require('../node/linkTag');
var TagNode = require('../node/tagNode');
var EscapedTag = require('../node/escapedTag');
var CompositeTag = require('../node/compositeTag');
var BbtagAttrsParser = require('./bbtagAttrsParser');
var ErrorTag = require('../node/errorTag');
var CommentNode = require('../node/commentNode');
var HeaderTag = require('../node/headerTag');
var VerbatimText = require('../node/verbatimText');
var makeAnchor = require('textUtil/makeAnchor');
var TextNode = require('../node/textNode');
var ParseError = require('./parseError');
var contextTypography = require('../typography/contextTypography');
var charTypography = require('../typography/charTypography');
var formatTitle = require('../typography/formatTitle');
var ensureSafeUrl = require('./ensureSafeUrl');

/**
 * BodyParser creates node objects from general text.
 * Node attrs will *not* be checked by sanitizers, they can contain anything like `onclick=`
 * This provides maximal freedom to the parser.
 *
 * Parser knows about current trust mode, so it must make sure that these attributes are safe.
 *
 * Parser builds a tree structure, parsing all text and if needed, transforming it on the fly,
 * so that a traversal may reach all descendants.
 *
 * The html transformer MAY generate more text, but MAY NOT generate more nodes in the process.
 *
 * @constructor
 */
function BodyParser(text, options) {
  if (!options.metadata) {
    options.metadata = {};
  }
  if (!options.metadata.refs) {
    options.metadata.refs = new StringSet();
  }
  if (!options.metadata.libs) {
    options.metadata.libs = new StringSet();
  }
  if (!options.metadata.head) {
    options.metadata.head = [];
  }
  if (!options.metadata.headers) {
    options.metadata.headers = [];
  }
  if (!options.metadata.headersAnchorMap) {
    options.metadata.headersAnchorMap = new StringMap();
  }

  Parser.call(this, options);

  this.lexer = new BodyLexer(text);
}

inherits(BodyParser, Parser);

BodyParser.prototype.validateOptions = function(options) {

  if (!("trusted" in options)) {
    throw new Error("Must have trusted option");
  }

};

//  Каждый вызов parse возвращает не узел, а массив узлов,
//  например [online] ... [/online] возвращает своё содержимое с учетом вложенных тегов
//  или пустой тег, если экспорт-режим
//  Это должен быть valid html
BodyParser.prototype.parse = function() {
  var buffer = '';
  var children = [];

  while (!this.lexer.isEof()) {

    var nodes = this.parseNodes();

    if (nodes) {

      if (nodes.length === undefined) {
        nodes = [nodes];
      }

      for (var i = 0; i < nodes.length; i++) {
        var node = nodes[i];

        if (buffer) {
          children.push(new TextNode(buffer));
          buffer = "";
        }
        children.push(node);
      }

    } else {
      buffer += this.lexer.consumeChar();
    }

  }

  if (buffer) {
    children.push(new TextNode(buffer));
  }

  return children;
};


/**
 * @returns tokens array or (most often, for perf reasons) null if no token found
 */
BodyParser.prototype.parseNodes = function() {

  var token = null;

  var char = this.lexer.getChar();
  // perf optimization for most chars
  switch (char) {
  case '[':
    token = this.lexer.consumeLink() || this.lexer.consumeBbtagSelfClose() || this.lexer.consumeBbtagNeedClose();
    break;
  case '`':
    // ``pattern`code` or just `code` OR ```js\n...```
    token = this.lexer.consumeSource() || this.lexer.consumeCode();
    break;
  case '~':
    token = this.lexer.consumeStrike();
    break;
  case '*':
    token = this.lexer.consumeBold() || this.lexer.consumeItalic();
    break;
  case '<':
    token = this.lexer.consumeImg() || this.lexer.consumeComment() || this.lexer.consumeVerbatimTag();
    break;
  case '#':
    token = this.lexer.consumeHeader();
    break;
  }

  if (token === null) return null;

  var methodName = 'parse' + token.type[0].toUpperCase() + token.type.slice(1);

  if (!this[methodName]) {
    throw new Error("Unknown token: " + JSON.stringify(token));
  }

  try {
    return this[methodName](token);
  } catch(e) {
    if (e instanceof ParseError) {
      return new ErrorTag(e.tag, e.message);
    } else {
      throw e;
    }
  }
};

/**
 * This does several things
 * 1) Parses header (must not contain external stuff)
 * 2) Checks header structure (and builds headers array)
 * @param token
 * @returns {*}
 */
BodyParser.prototype.parseHeader = function(token) {
  // no formatting/tags in headers, only typography
  var titleHtml = formatTitle(token.title);

  var level = token.level;

  // ---- Проверить уровень ----
  // Уровень ограничен 3, так как
  // во-первых, 3 должно быть достаточно
  // во-вторых, при экспорте h3 становится h5
  if (level > 3) {
    throw new ParseError('div', "Заголовок " + token.title + " слишком глубоко вложен (более чем 3 уровня)");
  }

  var headers = this.options.metadata.headers;


  if (headers.length === 0 && level != 1) {
    // в jade можно включить другие :simpledown-файлы
    // заголовки в них могут быть сразу с уровня 2 или даже 3, если это часть
    // поэтому первый заголовок может быть не 1
    // throw new ParseError('div', "Первый заголовок должен иметь уровень 1, а не " + level);
  }

  if (headers.length > 0) {
    var prevLevel = headers[headers.length - 1].level;
    if (level > prevLevel + 1) {
      throw new ParseError('div', "Некорректная вложенность заголовков (уровень " + level + " после " + prevLevel + ")");
    }
  }

  // проверить, нет ли уже заголовка с тем же названием
  // при фиксированном anchor к нему нельзя добавить -1 -2 -3
  // так что это ошибка
  if (token.anchor) {
    if (this.options.metadata.refs.has(token.anchor)) {
      throw new ParseError('div', '[#' + token.anchor + '] уже существует');
    }
  }

  // Проверить якорь, при необходимости добавить anchor-1, anchor-2
  var anchor = token.anchor || makeAnchor(titleHtml, this.options.translitAnchors);

  var headersAnchorMap = this.options.metadata.headersAnchorMap;

  if (headersAnchorMap.has(anchor)) {
    // если якорь использовался ранее, обычно к нему прибавляется номер,
    // но если он явно [#назначен] в заголовке - не имею права его менять, жёсткая ошибка
    if (token.anchor) {
      throw new ParseError('div', '[#' + token.anchor + '] используется в другом заголовке');
    }
    // иначе просто добавляю -2, -3 ...
    headersAnchorMap.set(anchor, headersAnchorMap.has(anchor) + 1);
    anchor = anchor + '-' + headersAnchorMap.get(anchor);
  } else {
    headersAnchorMap.set(anchor, 1);
  }

  // ------- Ошибок точно нет, можно запоминать заголовок и reference ------

  headers.push({ level: level, title: titleHtml, anchor: anchor});

  // ---- сохранить reference ---
  if (token.anchor) {
    this.options.metadata.refs.add(anchor);
  }

  return new HeaderTag(level, anchor, titleHtml);
};


/**
 * The parser is synchronous, we don't query DB here.
 *
 * Links in the form [](task/my-task) or [](mylesson) require title from DB
 * links in the form [](#ref) require reference from DB
 *  [ref] *may* exist later in this document, so we need parse it full before resolving
 * FIXME: move all link processing into second pass (single place)
 */
BodyParser.prototype.parseLink = function(token) {
  var href = token.href || token.title; // [http://ya.ru]() is fine
  var title = token.title; // [](http://ya.ru) is fine, but [](#test) - see below

  if (!this.trusted) ensureSafeUrl(href);

  var titleParsed = new BodyParser(title, this.options).parse();

  return new LinkTag(titleParsed, {href: href});
};

/*
 BodyParser.prototype.parseLink = function(token) {
 var href = token.href || token.title; // [http://ya.ru]() is fine
 var title = token.title || token.href; // [](http://ya.ru) is fine too

 var protocol = href.replace(/[\x00-\x20]/g, '').match(HREF_PROTOCOL_REG);
 if (protocol) {
 protocol = protocol[1].trim();
 }

 var titleParsed = new BodyParser(title, this.options).parse();

 // external link goes "as is"
 if (protocol) {
 if (!this.trusted && !~["http", "ftp", "https", "mailto"].indexOf(protocol.toLowerCase())) {
 throw new ParseError("span", "Протокол " + protocol + " не разрешён");
 }

 return new CompositeTag("a", titleParsed, {href: href});
 }

 if (href[0] == '/' || href[0] == '#') {
 return new CompositeTag("a", titleParsed, {href: href});
 }

 // relative link
 if (this.options.resourceWebRoot) {
 var resolver = new SrcResolver(href, this.options);
 return new CompositeTag("a", titleParsed, {href: resolver.getWebPath()});
 } else {
 throw new ParseError("span", "относительная ссылка в материале без точного URL: " + href);
 }
 };
 */
BodyParser.prototype.parseBbtag = function(token) {
  return new BbtagParser(token, this.options).parse();
};

BodyParser.prototype.parseBold = function(token) {
  return new BodyParser(token.body, this.options).parseAndWrap("strong");
};

BodyParser.prototype.parseItalic = function(token) {
  var parser = new BodyParser(token.body, this.options);
  return parser.parseAndWrap("em");
};

BodyParser.prototype.parseStrike = function(token) {
  var parser = new BodyParser(token.body, this.options);
  return parser.parseAndWrap("strike");
};

BodyParser.prototype.parseCode = function(token) {
  return new EscapedTag("code", token.body, token.codeClass ? {class: token.codeClass} : undefined);
};

BodyParser.prototype.parseComment = function(token) {
  return new CommentNode(token.body);
};

BodyParser.prototype.parseVerbatim = function(token) {
  return new VerbatimText(token.body);
};
