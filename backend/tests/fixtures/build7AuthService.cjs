// Frozen build 7 client from 266787b7a74a4b2e1735484ac7243ba99a3dde08 src/services/authService.ts
// Original source SHA-256: 642607c0a6bbaf2c7b9510c68efb86550654ecfde41ed9a9326d7f6277f84d86
// Type-only syntax removed for a backend-only test runtime; never bundled in the app.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthApiError = void 0;
exports.registerAccount = registerAccount;
exports.loginAccount = loginAccount;
exports.restoreAccountSession = restoreAccountSession;
exports.logoutAccount = logoutAccount;
exports.deleteAccount = deleteAccount;
exports.listConversionHistory = listConversionHistory;
exports.recordConversionHistory = recordConversionHistory;
exports.getAccountSessionToken = getAccountSessionToken;
const axios_1 = __importDefault(require("axios"));
const SecureStore = __importStar(require("expo-secure-store"));
const react_native_1 = require("react-native");
const mediaDownloaderApi_1 = require("./mediaDownloaderApi");
const sessionTokenKey = "editio.accountSession.v1";
let webSessionToken = null;
class AuthApiError extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = "AuthApiError";
    }
}
exports.AuthApiError = AuthApiError;
async function registerAccount(input) {
    try {
        const response = await axios_1.default.post(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/auth/register`, input, {
            timeout: 20000
        });
        await saveSessionToken(response.data.session.token);
        return response.data.user;
    }
    catch (error) {
        throw normalizeAuthError(error);
    }
}
async function loginAccount(email, password) {
    try {
        const response = await axios_1.default.post(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/auth/login`, { email, password }, {
            timeout: 20000
        });
        await saveSessionToken(response.data.session.token);
        return response.data.user;
    }
    catch (error) {
        throw normalizeAuthError(error);
    }
}
async function restoreAccountSession() {
    const token = await readSessionToken();
    if (!token)
        return null;
    try {
        const response = await axios_1.default.get(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 12000
        });
        return response.data.user;
    }
    catch (error) {
        if (axios_1.default.isAxiosError(error) && error.response?.status === 401) {
            await clearSessionToken();
            return null;
        }
        throw normalizeAuthError(error);
    }
}
async function logoutAccount() {
    const token = await readSessionToken();
    try {
        if (token) {
            await axios_1.default.post(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/auth/logout`, undefined, {
                headers: { Authorization: `Bearer ${token}` },
                timeout: 12000
            });
        }
    }
    catch (error) {
        if (!axios_1.default.isAxiosError(error) || error.response?.status !== 401) {
            throw normalizeAuthError(error);
        }
    }
    finally {
        await clearSessionToken();
    }
}
async function deleteAccount(password) {
    const token = await readSessionToken();
    if (!token)
        throw new AuthApiError("AUTH_REQUIRED", "Authentication is required.");
    try {
        await axios_1.default.delete(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/auth/account`, {
            headers: { Authorization: `Bearer ${token}` },
            data: { password },
            timeout: 20000
        });
        await clearSessionToken();
    }
    catch (error) {
        throw normalizeAuthError(error);
    }
}
async function listConversionHistory(limit = 30) {
    const token = await readSessionToken();
    if (!token)
        throw new AuthApiError("AUTH_REQUIRED", "Authentication is required.");
    try {
        const response = await axios_1.default.get(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/conversion-history`, {
            headers: { Authorization: `Bearer ${token}` },
            params: { limit: Math.max(1, Math.min(100, Math.trunc(limit))) },
            timeout: 12000
        });
        return response.data.items;
    }
    catch (error) {
        throw normalizeAuthError(error);
    }
}
async function recordConversionHistory(input) {
    const token = await readSessionToken();
    if (!token)
        return null;
    try {
        const response = await axios_1.default.post(`${(0, mediaDownloaderApi_1.getApiBaseUrl)()}/conversion-history`, input, {
            headers: { Authorization: `Bearer ${token}` },
            timeout: 12000
        });
        return response.data.item;
    }
    catch (error) {
        throw normalizeAuthError(error);
    }
}
async function saveSessionToken(token) {
    if (react_native_1.Platform.OS === "web") {
        webSessionToken = token;
        return;
    }
    await SecureStore.setItemAsync(sessionTokenKey, token, {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY
    });
}
async function readSessionToken() {
    if (react_native_1.Platform.OS === "web")
        return webSessionToken;
    return SecureStore.getItemAsync(sessionTokenKey);
}
async function getAccountSessionToken() {
    return readSessionToken();
}
async function clearSessionToken() {
    if (react_native_1.Platform.OS === "web") {
        webSessionToken = null;
        return;
    }
    await SecureStore.deleteItemAsync(sessionTokenKey);
}
function normalizeAuthError(error) {
    if (error instanceof AuthApiError)
        return error;
    if (!axios_1.default.isAxiosError(error))
        return new AuthApiError("UNKNOWN", "Account request failed.");
    const payload = error.response?.data;
    if (!error.response)
        return new AuthApiError("NETWORK_ERROR", "Account service is unavailable.");
    return new AuthApiError(payload?.code ?? `HTTP_${error.response.status}`, payload?.message ?? payload?.error ?? "Account request failed.");
}
