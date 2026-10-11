export type RegistrationInput = {
  firstName?: string; lastName?: string; email: string; password: string;
  acceptedTerms: boolean; ageConfirmed: boolean; minimumAge: number;
};
export function registrationError(input: RegistrationInput): string | null {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim()) || input.email.trim().length > 254) return "AUTH_INVALID_EMAIL";
  if (input.password.length < 10 || input.password.length > 128 || !/[a-z]/.test(input.password) || !/[A-Z]/.test(input.password) || !/[0-9]/.test(input.password)) return "AUTH_INVALID_PASSWORD";
  for (const name of [input.firstName ?? "", input.lastName ?? ""]) {
    if (name.trim().length > 80 || !/^$|^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u.test(name.trim())) return "AUTH_INVALID_NAME";
  }
  if (!input.acceptedTerms) return "TERMS_REQUIRED";
  if (!input.ageConfirmed) return "AGE_REQUIRED";
  if (!Number.isInteger(input.minimumAge) || input.minimumAge < 13 || input.minimumAge > 18) return "REGISTRATION_POLICY_CHANGED";
  return null;
}

export function accountDisplayName(user: { firstName?: string | null; lastName?: string | null; username?: string | null; email: string }): string {
  return [user.firstName, user.lastName].filter(value => typeof value === "string" && value.trim()).join(" ").trim() || user.username || user.email;
}
