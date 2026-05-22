import dns from "node:dns/promises";
import net from "node:net";
import { HttpError } from "./httpError.js";

const blockedHosts = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be"
]);

export async function validatePublicMediaUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new HttpError(400, "Invalid URL.");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new HttpError(400, "Only http and https URLs are supported.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
  if (blockedHosts.has(hostname) || hostname.endsWith(".youtube.com")) {
    throw new HttpError(400, "This endpoint accepts direct media URLs only.");
  }

  if (isPrivateHostname(hostname)) {
    throw new HttpError(400, "Private network URLs are not allowed.");
  }

  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new HttpError(400, "Private network URLs are not allowed.");
  }

  return parsed.toString();
}

function isPrivateHostname(hostname) {
  return hostname === "localhost" || hostname.endsWith(".local");
}

function isPrivateIp(address) {
  const version = net.isIP(address);
  if (version === 4) {
    const parts = address.split(".").map(Number);
    return (
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 169 && parts[1] === 254) ||
      parts[0] === 0
    );
  }

  if (version === 6) {
    const normalized = address.toLowerCase();
    return normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || normalized.startsWith("fe80");
  }

  return true;
}
