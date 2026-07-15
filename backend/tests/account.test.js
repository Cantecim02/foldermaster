import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";

const backendRoot = path.resolve(import.meta.dirname, "..");

test("account registration, session, login, logout, and deletion", async () => {
  await withServer(async (baseUrl) => {
    const account = {
      firstName: "Ada",
      lastName: "Lovelace",
      birthDate: "1990-12-10",
      email: "ada@example.com",
      password: "SecurePass123",
      acceptedTerms: true
    };

    const registered = await requestJson(baseUrl, "/auth/register", {
      method: "POST",
      body: account
    });
    assert.equal(registered.response.status, 201);
    assert.equal(registered.body.user.email, account.email);
    assert.equal(typeof registered.body.session.token, "string");
    assert.equal("password" in registered.body.user, false);

    const duplicate = await requestJson(baseUrl, "/auth/register", {
      method: "POST",
      body: account
    });
    assert.equal(duplicate.response.status, 409);
    assert.equal(duplicate.body.code, "ACCOUNT_EXISTS");

    const current = await requestJson(baseUrl, "/auth/me", {
      token: registered.body.session.token
    });
    assert.equal(current.response.status, 200);
    assert.equal(current.body.user.firstName, account.firstName);

    const loggedOut = await requestJson(baseUrl, "/auth/logout", {
      method: "POST",
      token: registered.body.session.token
    });
    assert.equal(loggedOut.response.status, 204);

    const expired = await requestJson(baseUrl, "/auth/me", {
      token: registered.body.session.token
    });
    assert.equal(expired.response.status, 401);

    const loggedIn = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: account.email, password: account.password }
    });
    assert.equal(loggedIn.response.status, 200);

    const deleted = await requestJson(baseUrl, "/auth/account", {
      method: "DELETE",
      token: loggedIn.body.session.token,
      body: { password: account.password }
    });
    assert.equal(deleted.response.status, 204);

    const loginAfterDelete = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: { email: account.email, password: account.password }
    });
    assert.equal(loginAfterDelete.response.status, 401);
  });
});

test("registration requires legal acceptance and a strong password", async () => {
  await withServer(async (baseUrl) => {
    const invalid = await requestJson(baseUrl, "/auth/register", {
      method: "POST",
      body: {
        firstName: "Test",
        lastName: "User",
        birthDate: "1990-01-01",
        email: "test@example.com",
        password: "weak",
        acceptedTerms: false
      }
    });
    assert.equal(invalid.response.status, 400);
    assert.equal(invalid.body.code, "INVALID_REQUEST");
    assert.equal("stack" in invalid.body, false);
  });
});

async function requestJson(baseUrl, pathname, { method = "GET", body, token } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  const rawBody = await response.text();
  return {
    response,
    body: rawBody ? JSON.parse(rawBody) : null
  };
}

async function withServer(run) {
  const port = 6200 + Math.floor(Math.random() * 600);
  const root = await mkdtemp(path.join(os.tmpdir(), "editio-account-test-"));
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      DOWNLOAD_DIR: path.join(root, "downloads"),
      DATABASE_PATH: path.join(root, "editio.sqlite"),
      AUTH_SESSION_DAYS: "30",
      MIN_ACCOUNT_AGE: "13",
      TERMS_VERSION: "2026-07-15",
      PRIVACY_VERSION: "2026-07-15"
    },
    stdio: ["ignore", "ignore", "pipe"]
  });

  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  try {
    await waitForHealth(port, () => stderr);
    await run(`http://127.0.0.1:${port}`);
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(3000)]);
    await rm(root, { recursive: true, force: true });
  }
}

async function waitForHealth(port, getStderr) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      await delay(100);
    }
  }
  throw new Error(`server did not become healthy: ${getStderr()}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
