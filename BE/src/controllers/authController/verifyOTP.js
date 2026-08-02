const implementation = require("../../controllerCore/authController");

module.exports = function verifyOTP(...args) {
  return implementation.verifyOTP(...args);
};
