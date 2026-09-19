export function normalizeEmail(value: string) {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string) {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('0084')) digits = `0${digits.slice(4)}`;
  else if (digits.startsWith('84')) digits = `0${digits.slice(2)}`;
  return digits;
}

export function isNormalizedPhone(value: string) {
  return /^\d{8,15}$/.test(value);
}
