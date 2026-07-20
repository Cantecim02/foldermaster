import express from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { config } from "../config.js";
import { authenticateOptionalRequest } from "../services/accountService.js";
import {
  completeConversionAuthorization,
  getBillingSnapshot,
  releaseConversionAuthorization,
  reserveConversionAuthorization,
  resolveBillingIdentity
} from "../services/billingStore.js";
import {
  processAppleNotification,
  verifyTransactionAndUpdateEntitlement
} from "../services/billingService.js";

const installationIdSchema = z.string().uuid();
const authorizationSchema = z.object({
  operationId: z.string().uuid(),
  conversionType: z.string().trim().min(1).max(64),
  installationId: installationIdSchema.optional()
});
const transactionSchema = z.object({
  signedTransactionInfo: z.string().min(100).max(250_000),
  environment: z.enum(["Production", "Sandbox", "Xcode", "LocalTesting"]).optional(),
  restore: z.boolean().optional().default(false),
  installationId: installationIdSchema.optional()
});
const notificationSchema = z.object({
  signedPayload: z.string().min(100).max(900_000)
});

export const billingRoutes = express.Router();
export const appleNotificationRoutes = express.Router();

appleNotificationRoutes.use(rateLimit({
  windowMs: 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false
}));
appleNotificationRoutes.post("/", async (request, response) => {
  const { signedPayload } = notificationSchema.parse(request.body);
  const result = await processAppleNotification(signedPayload);
  response.status(200).json(result);
});

billingRoutes.get("/config", (_request, response) => {
  response.json({
    monetizationEnabled: config.monetizationEnabled,
    freeConversionLimit: config.freeConversionLimit,
    products: {
      ios: config.appleProductIds,
      android: []
    },
    platforms: {
      ios: { subscriptions: config.monetizationEnabled },
      android: { subscriptions: false }
    },
    minimumIosBuild: config.monetizationMinIosBuild
  });
});

billingRoutes.get("/entitlement", (request, response) => {
  const identity = requestBillingIdentity(request);
  response.json({ success: true, ...getBillingSnapshot(identity) });
});

billingRoutes.post("/apple/transactions/verify", async (request, response) => {
  const input = transactionSchema.parse(request.body);
  const identity = requestBillingIdentity(request, input.installationId);
  const entitlement = await verifyTransactionAndUpdateEntitlement({
    identity,
    signedTransactionInfo: input.signedTransactionInfo,
    environment: input.environment,
    restore: input.restore
  });
  response.json({ success: true, entitlement });
});

billingRoutes.post("/conversion-authorizations", (request, response) => {
  const input = authorizationSchema.parse(request.body);
  const identity = requestBillingIdentity(request, input.installationId);
  const authorization = reserveConversionAuthorization({
    identity,
    operationId: input.operationId,
    conversionType: input.conversionType
  });
  response.status(201).json({ success: true, authorization });
});

billingRoutes.post("/conversion-authorizations/:id/complete", (request, response) => {
  const identity = requestBillingIdentity(request, request.body?.installationId);
  const entitlement = completeConversionAuthorization({ id: request.params.id, identity });
  response.json({ success: true, entitlement });
});

billingRoutes.post("/conversion-authorizations/:id/release", (request, response) => {
  const identity = requestBillingIdentity(request, request.body?.installationId);
  const entitlement = releaseConversionAuthorization({ id: request.params.id, identity });
  response.json({ success: true, entitlement });
});

function requestBillingIdentity(request, bodyInstallationId) {
  const auth = authenticateOptionalRequest(request);
  const rawInstallationId = bodyInstallationId ?? request.get("x-editio-installation-id") ?? null;
  const installationId = rawInstallationId ? installationIdSchema.parse(rawInstallationId) : null;
  return resolveBillingIdentity({ user: auth?.user ?? null, installationId });
}
