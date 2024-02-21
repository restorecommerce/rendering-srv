import _ from 'lodash:es';
module.exports = function ifeqHandlebarsExtensions(hbs, opts) {
    hbs.registerHelper("eq", function(value1, value2) {
      return _.isEqual(value1, value2);
    });
  };