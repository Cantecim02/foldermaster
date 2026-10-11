import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { parseRegistration } from "../services/accountValidation.js";
import {
  authenticateRequest,
  getAccountDatabase,
  deleteAccount,
  loginAccount,
  logoutAccount,
  publicUser,
  registerAccount
} from "../services/accountService.js";
import { hasQaPermission, QA_ACTIONS } from '../services/qaPermissionService.js';
import { HttpError } from '../utils/httpError.js';

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
const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(128)
}).strict();

const deleteSchema = z.object({
  password: z.string().min(1).max(128)
}).strict();

const qaLimiter = rateLimit({ windowMs: 60_000, limit: 180, standardHeaders: true, legacyHeaders: false });
function qaAccess(request) {
  const account = authenticateRequest(request);
  return {
    userId: account.user.id,
    qaTester: hasQaPermission(getAccountDatabase(), config, account.user.id),
    environment: config.appEnvironment,
    scope: 'file_basket_preview',
    leaseMs: 1500
  };
}
accountRoutes.get('/qa-access', qaLimiter, (request, response, next) => {
  try { response.set('Cache-Control', 'no-store').json(qaAccess(request)); } catch (error) { next(error); }
});
accountRoutes.post('/qa-access', qaLimiter, (request, response, next) => {
  try {
    z.object({ action: z.enum(QA_ACTIONS) }).strict().parse(request.body);
    const access = qaAccess(request);
    if (!access.qaTester) throw new HttpError(403, 'QA access denied', { code: 'QA_ACCESS_DENIED' });
    // Only a fresh permission check. No progress, quota, history or billing mutation.
    response.set('Cache-Control', 'no-store').json(access);
  } catch (error) { next(error); }
});

accountRoutes.post("/register", authLimiter, async (request, response, next) => {
  try {
    const result = await registerAccount(parseRegistration(request.body));
    response.status(201).json(result);
  } catch (error) {
    next(error);
  }
});

accountRoutes.get("/policy", (_request, response) => {
  response.json({ minimumAge: config.minAccountAge, registrationVersion: 2 });
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
    response.json({ user: publicUser(account.user), expiresAt: account.expiresAt });
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
