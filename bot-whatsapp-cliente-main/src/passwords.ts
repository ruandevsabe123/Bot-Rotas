import crypto from "crypto";

const PREFIX = "scrypt$";

export function hashPassword(password: string): string {
  if (isPasswordHash(password)) return password;
  const salt = crypto.randomBytes(16).toString("hex");
  return `${PREFIX}${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function isPasswordHash(value: string): boolean {
  return /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(value);
}

export function verifyPasswordSync(password: string, stored: string): boolean {
  if (!isPasswordHash(stored)) return password === stored;
  const [, salt, expected] = stored.split("$");
  return crypto.timingSafeEqual(crypto.scryptSync(password, salt, 64), Buffer.from(expected, "hex"));
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (!isPasswordHash(stored)) {
    const actual = crypto.createHash("sha256").update(password).digest();
    const expected = crypto.createHash("sha256").update(stored).digest();
    return crypto.timingSafeEqual(actual, expected);
  }
  const [, salt, expected] = stored.split("$");
  const derived = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (error, value) => error ? reject(error) : resolve(value));
  });
  return crypto.timingSafeEqual(derived, Buffer.from(expected, "hex"));
}
