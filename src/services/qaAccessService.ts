import axios from 'axios';
import { getAccountSessionToken } from './authService';
import { getApiBaseUrl } from './mediaDownloaderApi';
import type { QaAction } from './qaAccessController';

export async function checkQaAccess(action?: QaAction) {
  // This module is a QA panel dependency; ordinary release bundles exclude it.
  const actual = getApiBaseUrl().replace(/\/$/, '');
  // Build config checks both declarations. Runtime also refuses known production hosts.
  const url = new URL(actual);
  if (process.env.EXPO_PUBLIC_FILE_BASKET_QA !== 'true' || url.protocol !== 'https:' ||
      ['api.editioapp.com', 'editioapp.com', 'www.editioapp.com'].includes(url.hostname.toLowerCase()) ||
      url.username || url.password || url.search || url.hash) throw new Error('QA build/staging required');
  const token = await getAccountSessionToken();
  if (!token) throw new Error('QA session required');
  const options = { headers: { Authorization: `Bearer ${token}` }, timeout: 1000 };
  const response = action ? await axios.post(`${actual}/auth/qa-access`, { action }, options) : await axios.get(`${actual}/auth/qa-access`, options);
  return response.data;
}
