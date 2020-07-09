module.exports = function listHandlebarsExtensions(hbs, opts) {
  hbs.registerHelper("list", function(items, options) {
    const itemsAsHtml = items.map(item => "<li>" + options.fn(item) + "</li>");
    return "<ul>\n" + itemsAsHtml.join("\n") + "\n</ul>";
  });
};

// template:
// {{#list people}}{{firstname}} {{lastname}}{{/list}}

// input:
// {
//   people: [
//     {
//       firstname: "Yehuda",
//       lastname: "Katz",
//     },
//     {
//       firstname: "Carl",
//       lastname: "Lerche",
//     },
//     {
//       firstname: "Alan",
//       lastname: "Johnson",
//     },
//   ],
// }

// output:
// <ul>
// <li>Yehuda Katz</li>
// <li>Carl Lerche</li>
// <li>Alan Johnson</li>
// </ul>
