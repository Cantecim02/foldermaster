import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import {
  authenticateRequest,
  deleteAccount,
  loginAccount,
  logoutAccount,
  registerAccount
} from "../services/accountService.js";

export const accountRoutes = express.Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: false,
  handler(request, response) {
    response.status(429).json({
      success: false,
      code: "AUTH_RATE_LIMITED",
      message: "Too many account attempts. Please try again later.",
      error: "Too many account attempts. Please try again later.",
      requestId: request.id
    });
  }
});

const emailSchema = z.string().trim().email().max(254).transform((value) => value.toLowerCase());
const nameSchema = z.string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[\p{L}\p{M}][\p{L}\p{M}' -]*$/u, "Name contains unsupported characters.");
const strongPasswordSchema = z.string()
  .min(10)
  .max(128)
  .regex(/[a-z]/, "Password must contain a lowercase letter.")
  .regex(/[A-Z]/, "Password must contain an uppercase letter.")
  .regex(/[0-9]/, "Password must contain a number.");
const birthDateSchema = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Birth date must use YYYY-MM-DD format.")
  .refine(isRealDate, "Birth date is invalid.")
  .refine((value) => ageOnDate(value, new Date()) >= config.minAccountAge, `You must be at least ${config.minAccountAge} years old.`)
  .refine((value) => ageOnDate(value, new Date()) <= 120, "Birth date is invalid.");

const registerSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  birthDate: birthDateSchema,
  email: emailSchema,
  password: strongPasswordSchema,
  acceptedTerms: z.literal(true)
}).strict();

const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
}).strict();

const deleteSchema = z.object({
  password: z.string().min(1).max(128)
}).strict();

accountRoutes.post("/register", authLimiter, async (request, response, next) => {
  try {
    const result = await registerAccount(registerSchema.parse(request.body));
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

accountRoutes.post("/login", authLimiter, async (request, response, next) => {
  try {
    response.json(await loginAccount(loginSchema.parse(request.body)));
  } catch (error) {
    next(error);
  }
});

accountRoutes.get("/me", (request, response, next) => {
  try {
    const account = authenticateRequest(request);
    response.json({ user: account.user, expiresAt: account.expiresAt });
  } catch (error) {
    next(error);
  }
});

accountRoutes.post("/logout", (request, response, next) => {
  try {
    const account = authenticateRequest(request);
    logoutAccount(account.tokenHash);
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

accountRoutes.delete("/account", authLimiter, async (request, response, next) => {
  try {
    const account = authenticateRequest(request);
    const payload = deleteSchema.parse(request.body);
    await deleteAccount({ userId: account.user.id, password: payload.password });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

function isRealDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function ageOnDate(birthDate, now) {
  const [year, month, day] = birthDate.split("-").map(Number);
  let age = now.getUTCFullYear() - year;
  const monthDifference = now.getUTCMonth() + 1 - month;
  if (monthDifference < 0 || (monthDifference === 0 && now.getUTCDate() < day)) age -= 1;
  return age;
}
