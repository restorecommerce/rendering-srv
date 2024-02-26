import * as _ from 'lodash';
export default (hbs, opts) => {
    hbs.registerHelper('eq', function(value1, value2) {
      return _.isEqual(value1, value2);
    });
};