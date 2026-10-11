import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import Database from "better-sqlite3";
import argon2 from "argon2";
import { runAccountMigration } from "../src/services/accountMigrationRunner.js";
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
    assert.equal(registered.body.user.subscriptionStatus, "free");
    assert.equal(registered.body.user.subscriptionExpireDate, null);
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

test("conversion history stores metadata per account and is removed with the account", async () => {
  await withServer(async (baseUrl) => {
    const firstAccount = {
      firstName: "Grace",
      lastName: "Hopper",
      birthDate: "1990-12-09",
      email: "grace@example.com",
      password: "SecurePass123",
      acceptedTerms: true
    };
    const registered = await requestJson(baseUrl, "/auth/register", {
      method: "POST",
      body: firstAccount
    });
    const token = registered.body.session.token;

    const unauthorized = await requestJson(baseUrl, "/conversion-history");
    assert.equal(unauthorized.response.status, 401);

    const created = await requestJson(baseUrl, "/conversion-history", {
      method: "POST",
      token,
      body: {
        fileName: "invoice.pdf",
        from: "pdf",
        to: "jpg",
        fileSizeBytes: 4096,
        status: "completed"
      }
    });
    assert.equal(created.response.status, 201);
    assert.deepEqual(
      {
        fileName: created.body.item.fileName,
        from: created.body.item.from,
        to: created.body.item.to,
        fileSizeBytes: created.body.item.fileSizeBytes,
        status: created.body.item.status
      },
      {
        fileName: "invoice.pdf",
        from: "PDF",
        to: "JPG",
        fileSizeBytes: 4096,
        status: "completed"
      }
    );
    assert.equal("fileUrl" in created.body.item, false);

    const listed = await requestJson(baseUrl, "/conversion-history?limit=10", { token });
    assert.equal(listed.response.status, 200);
    assert.equal(listed.body.success, true);
    assert.equal(listed.body.items.length, 1);
    assert.equal(listed.body.items[0].fileName, "invoice.pdf");

    const second = await requestJson(baseUrl, "/auth/register", {
      method: "POST",
      body: {
        ...firstAccount,
        firstName: "Katherine",
        lastName: "Johnson",
        email: "katherine@example.com"
      }
    });
    const secondHistory = await requestJson(baseUrl, "/conversion-history", {
      token: second.body.session.token
    });
    assert.equal(secondHistory.body.items.length, 0);

    const invalid = await requestJson(baseUrl, "/conversion-history", {
      method: "POST",
      token,
      body: {
        fileName: "invoice.pdf",
        from: "PDF",
        to: "JPG",
        fileSizeBytes: -1,
        status: "completed",
        fileUrl: "https://example.com/private.pdf"
      }
    });
    assert.equal(invalid.response.status, 400);

    const deleted = await requestJson(baseUrl, "/auth/account", {
      method: "DELETE",
      token,
      body: { password: firstAccount.password }
    });
    assert.equal(deleted.response.status, 204);

    const recreated = await requestJson(baseUrl, "/auth/register", {
      method: "POST",
      body: firstAccount
    });
    const recreatedHistory = await requestJson(baseUrl, "/conversion-history", {
      token: recreated.body.session.token
    });
    assert.equal(recreatedHistory.body.items.length, 0);
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
    assert.equal(invalid.body.code, "AUTH_INVALID_PASSWORD");
    assert.equal("stack" in invalid.body, false);
  });
});

test("optional-name registration, policy and full session lifecycle", async () => {
 await withServer(async baseUrl => {
 const policy=await requestJson(baseUrl,"/auth/policy"); assert.deepEqual(policy.body,{minimumAge:13,registrationVersion:2});
 const input={email:"new@example.com",password:"SecurePass123",acceptedTerms:true,ageConfirmed:true,minimumAge:13};
 const result=await requestJson(baseUrl,"/auth/register",{method:"POST",body:input}); assert.equal(result.response.status,201);
 const {user,session}=result.body; assert.equal(user.firstName,""); assert.equal(user.lastName,""); assert.equal("birthDate" in user,false);
 assert.match(user.username,/^user-[a-f0-9]{32}$/); assert.notEqual(user.username,user.id); assert.notEqual(user.id,user.appAccountToken);
 assert.deepEqual((await requestJson(baseUrl,"/auth/me",{token:session.token})).body.user,user);
 assert.equal((await requestJson(baseUrl,"/auth/logout",{method:"POST",token:session.token})).response.status,204);
 assert.equal((await requestJson(baseUrl,"/auth/me",{token:session.token})).response.status,401);
 const login=await requestJson(baseUrl,"/auth/login",{method:"POST",body:{email:input.email,password:input.password}});assert.equal(login.response.status,200);assert.notEqual(login.body.session.token,session.token);assert.equal(login.body.user.username,user.username);
 assert.equal((await requestJson(baseUrl,"/auth/account",{method:"DELETE",token:login.body.session.token,body:{password:input.password}})).response.status,204);
 assert.equal((await requestJson(baseUrl,"/auth/me",{token:login.body.session.token})).response.status,401);
 });
});
test("actionable registration errors and repeated-attempt rate limit",async()=>{
 await withServer(async baseUrl=>{
 const input={email:"new@example.com",password:"SecurePass123",acceptedTerms:true,ageConfirmed:true,minimumAge:13};
 for(const [patch,code] of [[{email:"invalid"},"AUTH_INVALID_EMAIL"],[{password:"short"},"AUTH_INVALID_PASSWORD"],[{firstName:"<script>"},"AUTH_INVALID_NAME"],[{ageConfirmed:false},"AGE_REQUIRED"],[{acceptedTerms:false},"TERMS_REQUIRED"],[{minimumAge:12},"REGISTRATION_POLICY_CHANGED"],[{username:"forged"},"INVALID_REQUEST"],[{ageConfirmed:undefined,minimumAge:undefined,birthDate:"2000-02-30"},"BIRTH_DATE_INVALID"],[{ageConfirmed:undefined,minimumAge:undefined,birthDate:"2099-01-01"},"AGE_REQUIRED"]]){
 const result=await requestJson(baseUrl,"/auth/register",{method:"POST",body:{...input,...patch}});assert.equal(result.response.status,400);assert.equal(result.body.code,code);assert.equal(JSON.stringify(result.body).includes(input.password),false);assert.equal("details" in result.body,false);
 }
 await requestJson(baseUrl,"/auth/login",{method:"POST",body:{email:input.email,password:input.password}});
 const limited=await requestJson(baseUrl,"/auth/register",{method:"POST",body:input});assert.equal(limited.response.status,429);assert.equal(limited.body.code,"AUTH_RATE_LIMITED");
 });
});

test("old database migration keeps real session, password login and history usable", async () => {
 const token="s".repeat(43);
 await withServer(async(baseUrl,dbPath)=>{
   const me=await requestJson(baseUrl,"/auth/me",{token});assert.equal(me.response.status,200);assert.equal(me.body.user.id,"legacy-user");assert.equal(me.body.user.appAccountToken,"legacy-apple-token");assert.match(me.body.user.username,/^user-[a-f0-9]{32}$/);assert.equal("birthDate" in me.body.user,false);
   const history=await requestJson(baseUrl,"/conversion-history",{token});assert.equal(history.body.items.length,1);assert.equal(history.body.items[0].id,"legacy-history");
   const login=await requestJson(baseUrl,"/auth/login",{method:"POST",body:{email:"legacy@example.com",password:"SecurePass123"}});assert.equal(login.response.status,200);assert.equal(login.body.user.username,me.body.user.username);
   const db=new Database(dbPath,{readonly:true});try{assert.equal(db.prepare("SELECT birth_date FROM users WHERE id=?").get("legacy-user").birth_date,"1990-01-01");}finally{db.close();}
 },async dbPath=>{
   const hash=await argon2.hash("SecurePass123");const db=new Database(dbPath);
   try{db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,first_name TEXT NOT NULL,last_name TEXT NOT NULL,birth_date TEXT NOT NULL,email TEXT NOT NULL UNIQUE COLLATE NOCASE,password_hash TEXT NOT NULL,app_account_token TEXT UNIQUE,subscription_status TEXT NOT NULL DEFAULT 'free',subscription_expire_date TEXT,terms_version TEXT NOT NULL,privacy_version TEXT NOT NULL,accepted_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
   CREATE TABLE account_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);
   CREATE TABLE conversion_history(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,file_name TEXT NOT NULL,input_format TEXT NOT NULL,output_format TEXT NOT NULL,file_size_bytes INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);`);
   db.prepare("INSERT INTO users VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)").run("legacy-user","Ada","Lovelace","1990-01-01","legacy@example.com",hash,"legacy-apple-token","free",null,"terms","privacy","2020-01-01","2020-01-01","2020-01-01");
   db.prepare("INSERT INTO account_sessions VALUES (?,?,?,?)").run(createHash("sha256").update(token).digest("hex"),"legacy-user","2099-01-01","2020-01-01");
   db.prepare("INSERT INTO conversion_history VALUES (?,?,?,?,?,?,?,?)").run("legacy-history","legacy-user","test.pdf","PDF","JPG",123,"completed","2020-01-01");
   }finally{db.close();}
 });
});

test("registration uses configured minimum age rather than a fixed client age",async()=>{
 await withServer(async baseUrl=>{
 assert.equal((await requestJson(baseUrl,"/auth/policy")).body.minimumAge,18);
 const input={email:"adult@example.com",password:"SecurePass123",acceptedTerms:true,ageConfirmed:true,minimumAge:13};
 const stale=await requestJson(baseUrl,"/auth/register",{method:"POST",body:input});assert.equal(stale.response.status,400);assert.equal(stale.body.code,"REGISTRATION_POLICY_CHANGED");
 const below=await requestJson(baseUrl,"/auth/register",{method:"POST",body:{email:input.email,password:input.password,acceptedTerms:true,birthDate:`${new Date().getUTCFullYear()-15}-01-01`}});assert.equal(below.body.code,"AGE_REQUIRED");
 const result=await requestJson(baseUrl,"/auth/register",{method:"POST",body:{...input,minimumAge:18}});assert.equal(result.response.status,201);
 },undefined,18);
});

test("frozen TestFlight build 7 client runs against the new backend", async () => {
  await withServer(async baseUrl => {
    const old = build7Client(baseUrl);
    const input = { firstName: "Test", lastName: "Fixture", birthDate: "1990-01-01", email: "build7@example.com", password: "SecurePass123", acceptedTerms: true };
    const user = await old.registerAccount(input);
    assert.equal(user.firstName.slice(0, 1), "T");
    assert.equal((await old.restoreAccountSession()).id, user.id);
    await old.recordConversionHistory({fileName:"test.pdf",from:"PDF",to:"JPG",fileSizeBytes:123,status:"completed"});
    assert.equal((await old.listConversionHistory()).length,1);
    await old.logoutAccount();assert.equal(await old.restoreAccountSession(),null);
    assert.equal((await old.loginAccount(input.email,input.password)).id,user.id);
    await old.deleteAccount(input.password);assert.equal(await old.restoreAccountSession(),null);
    await assert.rejects(old.loginAccount(input.email,input.password),e=>e.code==="INVALID_CREDENTIALS");
    const next = await requestJson(baseUrl,"/auth/register",{method:"POST",body:{email:"new-model@example.com",password:input.password,acceptedTerms:true,ageConfirmed:true,minimumAge:13}});
    assert.equal(next.response.status,201);
    const nameless=await old.loginAccount("new-model@example.com",input.password);
    assert.equal(nameless.firstName.slice(0,1),"");assert.equal(nameless.lastName.slice(0,1),"");
    assert.equal((await old.restoreAccountSession()).id,next.body.user.id);
  });
});

function build7Client(baseUrl) {
  assert.equal(new URL(baseUrl).hostname,"127.0.0.1");
  let token=null;
  const axios={ isAxiosError:e=>e?.isAxiosError===true };
  for (const method of ["get","post","delete"]) axios[method]=async(url,dataOrOptions,postOptions)=>{
    const options=method==="post"?postOptions:dataOrOptions;
    const data=method==="post"?dataOrOptions:method==="delete"?options?.data:undefined;
    const response=await fetch(url,{method:method.toUpperCase(),headers:{"Content-Type":"application/json",...options?.headers},body:data?JSON.stringify(data):undefined});
    const text=await response.text();const body=text?JSON.parse(text):null;
    if(!response.ok)throw {isAxiosError:true,response:{status:response.status,data:body}};
    return {status:response.status,data:body};
  };
  const requireStub=id=>{
    if(id==="axios")return axios;
    if(id==="react-native")return {Platform:{OS:"ios"}};
    if(id==="./mediaDownloaderApi")return {getApiBaseUrl:()=>baseUrl};
    if(id==="expo-secure-store")return {setItemAsync:async(k,v)=>{token=v;},getItemAsync:async()=>token,deleteItemAsync:async()=>{token=null;}};
    throw Error("Unexpected frozen client dependency");
  };
  const module={exports:{}};
  const code=readFileSync(new URL("./fixtures/build7AuthService.cjs",import.meta.url),"utf8");
  vm.runInThisContext(`(function(require,module,exports){${code}\n})`)(requireStub,module,module.exports);
  return module.exports;
}

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

async function withServer(run, seed, minimumAge = 13) {
  const listener = createServer();
  await new Promise(resolve => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise(resolve => listener.close(resolve));
  const root = await mkdtemp(path.join(os.tmpdir(), "editio-account-test-"));
  if (seed) {
    await seed(path.join(root, "editio.sqlite"));
    const db = new Database(path.join(root, "editio.sqlite"));
    try {
      db.pragma("foreign_keys = ON");
      await runAccountMigration(db, { approval: "account-profile-v2", backupPath: path.join(root, "before-profile.sqlite") });
    } finally { db.close(); }
  }
  const child = spawn(process.execPath, ["src/server.js"], {
    cwd: backendRoot,
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(port),
      BIND_HOST: "127.0.0.1",
      MONETIZATION_ENABLED: "false",
      PUBLIC_BASE_URL: `http://127.0.0.1:${port}`,
      DOWNLOAD_DIR: path.join(root, "downloads"),
      DATABASE_PATH: path.join(root, "editio.sqlite"),
      AUTH_SESSION_DAYS: "30",
      MIN_ACCOUNT_AGE: String(minimumAge),
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
    await run(`http://127.0.0.1:${port}`, path.join(root, "editio.sqlite"));
  } finally {
    child.kill("SIGTERM");
    await Promise.race([once(child, "exit"), delay(3000)]);
    await rm(root, { recursive: true, force: true });
  }
}

async function waitForHealth(port, getStderr) {
  const deadline = Date.now() + 20_000;
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
