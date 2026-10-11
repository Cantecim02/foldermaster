import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";

if (!Number.isInteger(config.minAccountAge)) throw new Error("MIN_ACCOUNT_AGE must be an integer");

const name = z.string().trim().max(80).regex(/^$|^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u).nullable().optional();
const common = {
  firstName: name, lastName: name,
  email: z.string().trim().email().max(254).transform(value => value.toLowerCase()),
  password: z.string().min(10).max(128).regex(/[a-z]/).regex(/[A-Z]/).regex(/[0-9]/),
  acceptedTerms: z.literal(true)
};
const declaration = z.object({ ...common, ageConfirmed: z.literal(true), minimumAge: z.literal(config.minAccountAge) }).strict();
const legacy = z.object({ ...common, birthDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate) }).strict();

export function parseRegistration(input) {
  const isLegacy = input && typeof input === "object" && "birthDate" in input && !("ageConfirmed" in input);
  const parsed = (isLegacy ? legacy : declaration).safeParse(input);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const code = ({ email: "AUTH_INVALID_EMAIL", password: "AUTH_INVALID_PASSWORD", firstName: "AUTH_INVALID_NAME",
      lastName: "AUTH_INVALID_NAME", acceptedTerms: "TERMS_REQUIRED", ageConfirmed: "AGE_REQUIRED",
      minimumAge: "REGISTRATION_POLICY_CHANGED", birthDate: "BIRTH_DATE_INVALID" })[field] ?? "INVALID_REQUEST";
    throw new HttpError(400, "Account registration fields are invalid.", { code });
  }
  const value = parsed.data;
  if (isLegacy) {
    const age = ageOnDate(value.birthDate, new Date());
    if (age < config.minAccountAge || age > 120) throw new HttpError(400, "Account minimum age requirement was not met.", { code: "AGE_REQUIRED" });
  }
  // Old TestFlight clients remain compatible; legacy dates are validated then discarded.
  return { ...value, birthDate: undefined, minimumAge: config.minAccountAge, ageAttestationSource: isLegacy ? "legacy_birth_date" : "declaration" };
}

function isRealDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
function ageOnDate(value, now) {
  const [year, month, day] = value.split("-").map(Number);
  return now.getUTCFullYear() - year - Number(now.getUTCMonth() + 1 < month || (now.getUTCMonth() + 1 === month && now.getUTCDate() < day));
}
