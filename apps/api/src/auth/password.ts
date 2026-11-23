import bcrypt from 'bcryptjs';

const ROUNDS = Number(process.env.BCRYPT_ROUNDS ?? 10);
// Compared against when no user matches, so an unknown login takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', ROUNDS);

export const hashPassword = (password: string) => bcrypt.hash(password, ROUNDS);

export const verifyPassword = (password: string, hash?: string | null) =>
  bcrypt.compare(password, hash ?? DUMMY_HASH).then((ok) => ok && !!hash);

/** Normalises a Saudi phone number to 9665XXXXXXXX so different spellings sign in. */
export function normalizePhone(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (digits.startsWith('00966')) return digits.slice(2);
  if (digits.startsWith('966')) return digits;
  if (digits.startsWith('05')) return '966' + digits.slice(1);
  if (digits.startsWith('5') && digits.length === 9) return '966' + digits;
  return digits;
}
