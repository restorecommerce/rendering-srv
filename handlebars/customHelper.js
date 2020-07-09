module.exports = function loudHandlebarsExtensions(hbs, opts) {
  hbs.registerHelper('loud', function (aString) {
    return aString.toUpperCase()
  });
};

// template:
// {{firstname}} {{loud lastname}}

// input:
// {
//   firstname: "Yehuda",
//   lastname: "Katz",
// }

// output:
// Yehuda KATZ

