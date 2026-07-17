const {
  normalizeEmail,
  validateUsername,
  signAccessToken,
  signSetupToken,
  verifySetupToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  buildPublicUser,
} = require("../../src/utils/authHelpers");

describe("Black-box tests - authentication public functions", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = "lab4-black-box-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test("public user response follows the safe-field contract", () => {
    expect(buildPublicUser({ id: "u1", email: "a@test.com", username: "alice", full_name: "Alice" })).toEqual({
      id: "u1", email: "a@test.com", username: "alice", full_name: "Alice", role: "USER", status: "ACTIVE",
    });
  });

  test.each([
    "user..name@example.com",
    "user@-example.com",
  ])("rejects malformed email %s", (email) => {
    expect(() => normalizeEmail(email)).toThrow("Email không hợp lệ");
  });

  test.each([".student", "student..01"])("rejects malformed username %s", (username) => {
    expect(validateUsername(username).valid).toBe(false);
  });

  test("does not issue an access token without a session", () => {
    expect(() => signAccessToken({ id: "u1", email: "a@test.com" })).toThrow();
  });

  test("does not issue a setup token for an invalid email", () => {
    expect(() => signSetupToken("invalid-email")).toThrow("Email không hợp lệ");
  });

  test("token verification treats email casing as equivalent", () => {
    expect(() => verifySetupToken(signSetupToken("Student@Example.com"), "student@example.com")).not.toThrow();
    expect(() => verifyPasswordResetToken(signPasswordResetToken("Student@Example.com"), "student@example.com")).not.toThrow();
  });
});
