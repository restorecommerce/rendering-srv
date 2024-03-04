const _ = require('lodash');
module.exports = function (hbs, opts) {
    hbs.registerHelper('eq', function(value1, value2) {
      return _.isEqual(value1, value2);
    });
};