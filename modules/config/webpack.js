var fs = require('fs');
var nib = require('nib');
var path = require('path');
var config = require('config');
var webpack = require('webpack');
var CommonsChunkPlugin = require("webpack/lib/optimize/CommonsChunkPlugin");
var WriteVersionsPlugin = require('lib/webpack/writeVersionsPlugin');
var ExtractTextPlugin = require("extract-text-webpack-plugin");
var I18nPlugin = require("i18n-webpack-plugin");
var del = require('del');

// 3rd party / slow to build modules
// no webpack dependencies inside
// no es6 (for 6to5 processing) inside
// NB: includes angular-*
var noProcessModulesRegExp = /node_modules\/(angular|prismjs)/;

// tutorial.js?hash
// tutorial.hash.js
function extHash(name, ext, hash) {
  if (!hash) hash = '[hash]';
  return config.assetVersioning == 'query' ? `${name}.${ext}?${hash}` :
    config.assetVersioning == 'file' ? `${name}.${hash}.${ext}` :
      `${name}.${ext}`;
}

var webpackConfig = {
  output: {
    // fs path
    path:       path.join(config.publicRoot, 'pack'),
    // path as js sees it
    // if I use another domain here, need enable Allow-Access-.. header there
    // and add  to scripts, to let error handler track errors
    publicPath: '/pack/',
    // в dev-режиме файлы будут вида [name].js, но обращения - через [name].js?[hash], т.е. версия учтена
    // в prod-режиме не можем ?, т.к. CDN его обрезают, поэтому [hash] в имени
    //  (какой-то [hash] здесь необходим, иначе к chunk'ам типа 3.js, которые генерируются require.ensure,
    //  будет обращение без хэша при загрузке внутри сборки. при изменении - барузерный кеш их не подхватит)
    filename:   extHash("[name]", 'js'),

    chunkFilename: extHash("[name]-[id]", 'js'),
    library:       '[name]'
  },

  cache: process.env.NODE_ENV == 'development',

  watchOptions: {
    aggregateTimeout: 10
  },

  watch: process.env.NODE_ENV == 'development',

  devtool: process.env.NODE_ENV == 'development' ? "" : // try "eval" ?
             process.env.NODE_ENV == 'production' ? 'source-map' : "",

  profile: true,

  entry: {
//    styles:                    'styles/' + config.lang,
    about:                     'about/client',
    auth:                      'auth/client',
    angular:                   'client/angular',
    head:                      'client/head',
    tutorial:                  'tutorial/client',
    profile:                   'profile/client',
    search:                    'search/client',
    quiz:                      'quiz/client',
    ebook:                     'ebook/client',
    coursesCourse:             'courses/client/course',
    coursesSignup:             'courses/client/signup',
    coursesParticipantDetails: 'courses/client/participantDetails',
    coursesMaterials:          'courses/client/materials',
    coursesFeedbackEdit:       'courses/client/feedbackEdit',
    coursesFeedbackList:       'courses/client/feedbackList',
    coursesFeedbackShow:       'courses/client/feedbackShow',
    coursesFrontpage:          'courses/client/frontpage',
    profileGuestAboutMe:       'profileGuest/client/aboutMe',
    footer:                    'client/footer',
    nodejsScreencast:          'nodejsScreencast/client',
    webpackScreencast:         'webpackScreencast/client'
  },

  externals: {
    // require("angular") is external and available
    // on the global var angular
    angular: "angular"
  },

  module: {
    loaders: [
      {
        test:   /\.jade$/,
        loader: "jade?root=" + config.projectRoot + '/templates'
      },
      {
        test:    /\.js$/,
        // babel shouldn't process modules which contain ws/browser.js,
        // which must not be run in strict mode (global becomes undefined)
        // babel would make all modules strict!
        exclude: /node_modules\/(angular|prismjs|moment|blueimp-canvas-to-blob)/,
        loaders: ['ng-annotate', 'babel'] // babel will work first
      },
      {
        test:   /\.styl$/,
        // ExtractTextPlugin breaks HMR for CSS
        loader: ExtractTextPlugin.extract('style', 'css!autoprefixer?browsers=last 2 version!hover!stylus?linenos=true')
        //loader: 'style!css!autoprefixer?browsers=last 2 version!stylus?linenos=true'
      },
      {
        test:   /\.(png|jpg|gif|woff|eot|otf|ttf|svg)$/,
        loader: extHash('file?name=[path][name]', '[ext]')
      }
    ],
    noParse: [
      // regexp gets full path with loader like
      // '/js/javascript-nodejs/node_modules/client/angular.js'
      // or even
      // '/js/javascript-nodejs/node_modules/6to5-loader/index.js?modules=commonInterop!/js/javascript-nodejs/node_modules/client/head/index.js'
      {
        test: function(path) {
          //console.log(path);
          return noProcessModulesRegExp.test(path);
        }
      }
    ]
  },

  stylus: {
    use: [
      nib(),
      function(style) {
        style.define('lang', config.lang);
      }]
  },

  resolve: {
    // allow require('styles') which looks for styles/index.styl
    extensions: ['', '.js', '.styl'],
    alias:      {
      lodash:          'lodash/dist/lodash',
      angular:         'angular/angular',
      angularRouter:   'angular-ui-router/release/angular-ui-router',
      angularCookies:  'angular-cookies/angular-cookies',
      angularResource: 'angular-resource/angular-resource'
    }
  },

  node: {
    fs: 'empty'
  },

  plugins: [
    new webpack.DefinePlugin({
      LANG: JSON.stringify(config.lang)
    }),

    // lodash is loaded when free variable _ occurs in the code
    new webpack.ProvidePlugin({
      _: 'lodash'
    }),

    // prevent autorequire all moment locales
    // https://github.com/webpack/webpack/issues/198
    new webpack.IgnorePlugin(/^\.\/locale$/, /moment$/),

    // any common chunks from entries go to head
    new CommonsChunkPlugin("head", extHash("head", 'js')),
    new WriteVersionsPlugin(path.join(config.manifestRoot, "pack.versions.json")),

    new ExtractTextPlugin(extHash('[name]', 'css', '[contenthash]'), {allChunks: true}),

    new I18nPlugin(require(path.join(config.localesRoot, config.lang, 'translation')))
  ],

  recordsPath: path.join(config.tmpRoot, 'webpack.json'),
  devServer:   {
    port:               3001, // dev server itself does not use it, but outer tasks do
    historyApiFallback: true,
    hot:                true,
    watchDelay:         10,
    //noInfo: true,
    publicPath:         process.env.STATIC_HOST + ':3001/pack/',
    contentBase:        config.publicRoot
  }
};


//if (process.env.NODE_ENV != 'development') { // production, ebook
if (process.env.NODE_ENV == 'production') { // production, ebook
  webpackConfig.plugins.push(
    function clearBeforeRun() {
      function clear(compiler, callback) {
        del.sync(this.options.output.path + '/*');
        callback();
      }

      // in watch mode this will clear between partial rebuilds
      // thus removing unchanged files
      // => use this plugin only in normal run
      this.plugin('run', clear);
    },

    /* jshint -W106 */
    new webpack.optimize.UglifyJsPlugin({
      compress: {
        // don't show unreachable variables etc
        warnings:     false,
        drop_console: true,
        unsafe:       true,
        screw_ie8:    true
      },
      beautify: true,
      output:   {
        indent_level: 0 // for error reporting, to see which line actually has the problem
        // source maps actually didn't work in Qbaka that's why I put it here
      }
    })
  );
}

module.exports = webpackConfig;

