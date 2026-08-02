const implementation = require("../../controllerCore/authController");

module.exports = function logout(...args) {
  return implementation.logout(...args);
};
