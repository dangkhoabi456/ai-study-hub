const jwt = require("jsonwebtoken");

const {
  normalizeEmail,
  normalizeUsername,
  validateUsername,
  validatePassword,
  generateOtp,
  getOtpExpiryDate,
  hashPassword,
  signAccessToken,
} = require("../../src/utils/authHelpers");

describe("System test - authentication helpers", () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeAll(() => {
    process.env.JWT_SECRET = "lab4-system-test-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = originalSecret;
  });

  test("normalizes a valid email", () => {
    expect(normalizeEmail("  Student@Example.COM ")).toBe("student@example.com");
  });

  test("normalizes a username", () => {
    expect(normalizeUsername("  student_01  ")).toBe("student_01");
  });

  test("accepts a supported username and strong password", () => {
    expect(validateUsername("student.01")).toEqual({ valid: true, username: "student.01" });
    expect(validatePassword("studyhub1!")).toEqual({ valid: true });
  });

  test("generates a six-digit OTP with a ten-minute expiry", () => {
    expect(generateOtp()).toMatch(/^\d{6}$/);
    const before = Date.now() + 10 * 60 * 1000;
    const expiry = getOtpExpiryDate().getTime();
    const after = Date.now() + 10 * 60 * 1000;
    expect(expiry).toBeGreaterThanOrEqual(before);
    expect(expiry).toBeLessThanOrEqual(after);
  });

  test("hashes passwords with bcrypt", async () => {
    const hash = await hashPassword("studyhub1!");
    expect(hash).not.toBe("studyhub1!");
    expect(hash).toMatch(/^\$2[aby]\$/);
  });

  test("issues a session-bound access token", () => {
    const user = { id: "u1", email: "student@example.com", session_id: "s1" };
    expect(jwt.verify(signAccessToken(user), process.env.JWT_SECRET)).toMatchObject({
      userId: "u1", role: "USER", status: "ACTIVE", session_id: "s1",
    });
  });
});
