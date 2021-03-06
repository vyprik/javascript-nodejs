var Order = require('payments').Order;
var Discount = require('payments').Discount;
var OrderCreateError = require('payments').OrderCreateError;
var CourseGroup = require('../models/courseGroup');
var pluralize = require('textUtil/pluralize');
var _ = require('lodash');
var log = require('log')();

// middleware
// create order from template,
// use the incoming data if needed
module.exports = function*(orderTemplate, user, requestBody) {

  var group = yield CourseGroup.findOne({slug: requestBody.slug}).exec();

  var orderData = {
    group: group._id
  };
  orderData.count = +requestBody.count;

  if (group.participantsLimit === 0) {
    throw new OrderCreateError("Извините, в этой группе уже нет мест.");
  }

  if (orderData.count > group.participantsLimit) {
    throw new OrderCreateError("Извините, уже нет такого количества мест. Уменьшите количество участников до " + group.participantsLimit + '.');
  }

  orderData.contactName = String(requestBody.contactName);

  if (!orderData.contactName) {
    throw new OrderCreateError("Не указано контактное лицо.");
  }

  orderData.contactPhone = String(requestBody.contactPhone || '');

  var emails = requestBody.emails;
  if (!Array.isArray(emails)) {
    throw new OrderCreateError("Отсутствуют участники.");
  }
  orderData.emails = _.unique(emails.filter(Boolean).map(String));

  if (!user) {
    throw new OrderCreateError("Вы не авторизованы.");
  }


  var price = group.price;
  var discount;
  if (requestBody.discountCode) {
    discount = yield* Discount.findByCodeAndModule(requestBody.discountCode, 'courses');
    if (discount && discount.data.slug != group.slug) {
      discount = null;
    }

    if (discount) {
      price = discount.adjustAmount(price);
    }
  }

  if (!group.isOpenForSignup && !discount) {
    throw new OrderCreateError("Запись в эту группу завершена, извините.");
  }


  var order = new Order({
    title:  group.title,
    amount: orderData.count * price,
    module: orderTemplate.module,
    data:   orderData,
    email:  user.email,
    user:   user._id
  });

  yield order.persist();

  return order;

};


