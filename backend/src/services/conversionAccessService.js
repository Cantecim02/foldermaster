import { z } from "zod";
import { config } from "../config.js";
import { HttpError } from "../utils/httpError.js";
import { authenticateOptionalRequest } from "./accountService.js";
import {
  completeConversionAuthorization,
  releaseConversionAuthorization,
  resolveBillingIdentity,
  validateConversionAuthorization
} from "./billingStore.js";

const uuidSchema = z.string().uuid();
const billingProtocolVersion = 1;

export function requireConversionClientCompatibility(request, _response, next) {
  try {
    assertConversionClientCompatibility(request);
    request.editioConversionAccess = authorizeBackendConversion(request);
    next();
  } catch (error) {
    next(error);
  }
}

export function assertConversionClientCompatibility(request) {
  if (!config.monetizationEnabled || request.get("x-editio-conversion-authorization")) return;

  const platform = request.get("x-editio-client-platform")?.trim().toLowerCase();
  const protocol = parseUnsignedInteger(request.get("x-editio-billing-version"));
  const build = parseUnsignedInteger(request.get("x-editio-client-build"));
  const monetizationCapable = request.get("x-editio-monetization-capable") === "true";
  const minimumBuild = config.monetizationMinIosBuild;
  const isSupportedClient =
    platform === "ios" &&
    monetizationCapable &&
    protocol === billingProtocolVersion &&
    build !== null &&
    (minimumBuild === null || build >= minimumBuild);

  // Client metadata only chooses the safe failure response. It never grants access;
  // a server-issued authorization UUID is still mandatory for every conversion.
  if (isSupportedClient) {
    throw new HttpError(409, "Start the conversion again to obtain authorization.", {
      code: "CONVERSION_AUTHORIZATION_REQUIRED"
    });
  }

  throw new HttpError(426, "This Editio build must be updated before conversions can continue.", {
    code: "CLIENT_UPDATE_REQUIRED",
    details: minimumBuild === null ? undefined : { minimumIosBuild: minimumBuild }
  });
}

export function authorizeBackendConversion(request) {
  if (!config.monetizationEnabled) {
    return {
      id: null,
      complete() {},
      release() {}
    };
  }

  const auth = authenticateOptionalRequest(request);
  const rawInstallationId = request.get("x-editio-installation-id");
  const installationId = rawInstallationId ? uuidSchema.parse(rawInstallationId) : null;
  const identity = resolveBillingIdentity({ user: auth?.user ?? null, installationId });
  const id = uuidSchema.parse(request.get("x-editio-conversion-authorization"));
  validateConversionAuthorization({ id, identity });

  return {
    id,
    complete() {
      return completeConversionAuthorization({ id, identity });
    },
    release() {
      return releaseConversionAuthorization({ id, identity });
    }
  };
}

function parseUnsignedInteger(value) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}
