const {
  normalizeEmail,
  validateUsername,
  validatePassword,
  buildPublicUser,
} = require("../../src/utils/authHelpers");

describe("authHelpers", () => {
  test("normalizeEmail trims and lowercases email", () => {
    expect(normalizeEmail("  Test@Email.COM  ")).toBe("test@email.com");
  });

  test("normalizeEmail throws for invalid email", () => {
    expect(() => normalizeEmail("abc")).toThrow("Email không hợp lệ");
  });

  test("validateUsername accepts valid username", () => {
    expect(validateUsername(" user_01 ")).toEqual({
      valid: true,
      username: "user_01",
    });
  });

  test("validatePassword rejects weak password", () => {
    expect(validatePassword("12345678").valid).toBe(false);
  });

  test("buildPublicUser returns safe public user data", () => {
    const result = buildPublicUser({
      id: "u1",
      email: "a@test.com",
      username: "alice",
      full_name: "Alice",
      password: "secret",
    });

    expect(result).toEqual({
      id: "u1",
      email: "a@test.com",
      username: "alice",
      full_name: "Alice",
      role: "USER",
      status: "ACTIVE",
    });
    expect(result.password).toBeUndefined();
  });
});
