// Pure input validation/normalisation for staff accounts. Each function returns { value, error }.
const LOGIN_ID = /^[a-z0-9][a-z0-9._-]{2,29}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const isString = (value) => typeof value === 'string';

export function normalizeLoginId(input) {
  if (!isString(input) || !input.trim()) return { error: 'Staff login ID is required.' };
  const value = input.trim().toLowerCase();
  if (!LOGIN_ID.test(value)) return { error: 'Login ID must be 3–30 characters: letters, numbers, dots, dashes or underscores, starting with a letter or number.' };
  return { value };
}

// "Full name" is stored as firstName + lastName (the existing User fields). A single word is allowed for staff.
export function splitFullName(input) {
  if (!isString(input) || !input.trim()) return { error: 'Full name is required.' };
  const name = input.trim().replace(/\s+/g, ' ');
  if (name.length > 120) return { error: 'Full name is too long.' };
  const space = name.indexOf(' ');
  const firstName = space === -1 ? name : name.slice(0, space);
  const lastName = space === -1 ? '' : name.slice(space + 1);
  if (firstName.length > 60 || lastName.length > 60) return { error: 'First and last name must each be 60 characters or fewer.' };
  return { value: { firstName, lastName } };
}

// Policy for owner-supplied temporary passwords (never generated or returned by the server).
export function validateTemporaryPassword(input, loginId = '') {
  if (!isString(input) || !input) return { error: 'A temporary password is required.' };
  if (input.length < 10) return { error: 'Temporary password must be at least 10 characters.' };
  if (input.length > 128) return { error: 'Temporary password is too long.' };
  if (!/[A-Za-z]/.test(input) || !/\d/.test(input)) return { error: 'Temporary password must contain at least one letter and one number.' };
  if (loginId && input.toLowerCase() === String(loginId).toLowerCase()) return { error: 'Temporary password must not be the same as the login ID.' };
  return { value: input };
}

// Optional field: empty / missing means "not provided" (value undefined), never a placeholder.
export function normalizeOptionalEmail(input) {
  if (input === undefined || input === null || (isString(input) && !input.trim())) return { value: undefined };
  if (!isString(input)) return { error: 'Enter a valid email address.' };
  const value = input.trim().toLowerCase();
  if (value.length > 254 || !EMAIL.test(value)) return { error: 'Enter a valid email address.' };
  return { value };
}

export function normalizeOptionalMobile(input) {
  if (input === undefined || input === null || (isString(input) && !input.trim())) return { value: undefined };
  if (!isString(input)) return { error: 'Enter a valid 10-digit Indian mobile number.' };
  const digits = input.replace(/\D/g, '');
  const mobile = digits.length === 12 && digits.startsWith('91') ? digits.slice(2) : digits;
  if (!/^[6-9]\d{9}$/.test(mobile)) return { error: 'Enter a valid 10-digit Indian mobile number.' };
  return { value: mobile };
}
