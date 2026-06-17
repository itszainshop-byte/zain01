import axios from 'axios';
import Settings from '../models/Settings.js';

const DEFAULT_HOST = 'https://pay.hyp.co.il/p/';

function parseBool(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const v = String(value || '').trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(v)) return false;
  return fallback;
}

function normalizeHost(host) {
  if (!host) return DEFAULT_HOST;
  const h = String(host).trim();
  if (h.endsWith('/')) return h;
  return `${h}/`;
}

function coalesce(...vals) {
  for (const v of vals) {
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return undefined;
}

function normalizeLang(value) {
  const v = String(value || '').toUpperCase();
  if (v === 'HE' || v === 'HEB') return 'HEB';
  if (v === 'EN' || v === 'ENG') return 'ENG';
  return '';
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mapCurrencyToCoin(currency) {
  const cur = String(currency || '').trim().toUpperCase();
  if (['ILS', 'NIS', '₪'].includes(cur)) return 1;
  if (cur === 'USD' || cur === 'USDT') return 2;
  if (cur === 'EUR') return 3;
  if (cur === 'GBP' || cur === 'UKL') return 4;
  return 1; // default ILS
}

export function buildAmount(session) {
  const itemsTotal = (session?.items || []).reduce((sum, item) => {
    const qty = normalizeNumber(item.quantity, 0);
    const price = normalizeNumber(item.price, 0);
    return sum + qty * price;
  }, 0);
  const couponDiscount = normalizeNumber(session?.coupon?.discount, 0);
  const shippingFee = normalizeNumber(session?.shippingFee, 0);
  const totalWithShipping = normalizeNumber(session?.totalWithShipping, itemsTotal - couponDiscount + shippingFee);
  const giftCard = normalizeNumber(session?.giftCard?.amount, 0);
  const cardChargeAmount = normalizeNumber(session?.cardChargeAmount, Math.max(0, totalWithShipping - giftCard));
  return { itemsTotal, couponDiscount, shippingFee, totalWithShipping, cardChargeAmount };
}

export async function loadHypaySettings() {
  // Respect explicit enable via env, but do not force-disable DB config if env is falsy by mistake
  const envEnabledRaw = process.env.HYPAY_ENABLED;
  const envEnabled = typeof envEnabledRaw === 'string' ? parseBool(envEnabledRaw, undefined) : undefined;
  const useSkipDb = process.env.SKIP_DB === '1';

  const envConfig = {
    enabled: envEnabled,
    masof: process.env.HYPAY_MASOF || '',
    apiKey: process.env.HYPAY_API_KEY || '',
    passp: process.env.HYPAY_PASSP || process.env.HYPAY_PASS || '',
    info: process.env.HYPAY_INFO || '',
    pageLang: process.env.HYPAY_LANG || process.env.HYPAY_PAGE_LANG || '',
    template: process.env.HYPAY_TEMPLATE || '',
    tash: typeof process.env.HYPAY_TASH !== 'undefined' ? normalizeNumber(process.env.HYPAY_TASH, 0) : undefined,
    fixTash: typeof process.env.HYPAY_FIX_TASH !== 'undefined' ? parseBool(process.env.HYPAY_FIX_TASH, false) : undefined,
    tashType: typeof process.env.HYPAY_TASH_TYPE === 'string' ? process.env.HYPAY_TASH_TYPE : undefined,
    hideButtons: parseBool(process.env.HYPAY_HIDE_BUTTONS, false),
    moreData: parseBool(process.env.HYPAY_MORE_DATA, true),
    successUrl: process.env.HYPAY_SUCCESS_URL || '',
    failureUrl: process.env.HYPAY_FAILURE_URL || '',
    host: process.env.HYPAY_HOST || DEFAULT_HOST
  };

  if (useSkipDb) {
    return {
      enabled: envEnabled ?? true,
      ...envConfig
    };
  }

  const settings = await Settings.findOne().lean();
  const cfg = settings?.payments?.hypay || {};

  return {
    // If env explicitly enables, force on; otherwise fall back to DB flag (env false won't override DB)
    enabled: envEnabled === true ? true : !!cfg.enabled,
    masof: envConfig.masof || cfg.masof || '',
    apiKey: envConfig.apiKey || cfg.apiKey || '',
    passp: envConfig.passp || cfg.passp || '',
    info: envConfig.info || cfg.info || 'Online order',
    pageLang: normalizeLang(envConfig.pageLang || cfg.pageLang || ''),
    template: envConfig.template || cfg.template || '',
    tash: typeof envConfig.tash === 'number' ? normalizeNumber(envConfig.tash, 0) : normalizeNumber(cfg.tash, 0),
    fixTash: typeof envConfig.fixTash === 'boolean' ? envConfig.fixTash : !!cfg.fixTash,
    tashType: typeof envConfig.tashType === 'string' ? envConfig.tashType : cfg.tashType || '',
    hideButtons: envConfig.hideButtons || !!cfg.hideButtons,
    moreData: typeof envConfig.moreData === 'boolean' ? envConfig.moreData : !!cfg.moreData,
    successUrl: envConfig.successUrl || cfg.successUrl || '',
    failureUrl: envConfig.failureUrl || cfg.failureUrl || '',
    host: normalizeHost(envConfig.host || cfg.host || DEFAULT_HOST)
  };
}

function buildBaseParams({ session, settings, overrides = {} }) {
  if (!settings?.masof || !settings?.apiKey || !settings?.passp) {
    const err = new Error('hypay_missing_credentials');
    err.status = 412;
    throw err;
  }

  const { cardChargeAmount } = buildAmount(session);
  if (!(cardChargeAmount > 0)) {
    const err = new Error('hypay_invalid_amount');
    err.status = 400;
    throw err;
  }

  const ci = session?.customerInfo || {};
  const addr = session?.shippingAddress || {};
  const mobileDigits = String(ci.mobile || '').replace(/\D/g, '');
  const phoneDigits = String(ci.secondaryMobile || '').replace(/\D/g, '');

  const params = {
    action: 'APISign',
    What: 'SIGN',
    KEY: settings.apiKey,
    PassP: settings.passp,
    Masof: settings.masof,
    Order: coalesce(overrides.order, session?.reference, String(session?._id || '')),
    Info: coalesce(overrides.info, settings.info, 'Online order'),
    Amount: cardChargeAmount,
    UTF8: 'True',
    UTF8out: 'True',
    Sign: 'True',
    MoreData: settings.moreData ? 'True' : 'False',
    PageLang: normalizeLang(settings.pageLang) || undefined,
    Tash: normalizeNumber(settings.tash, 0) > 0 ? normalizeNumber(settings.tash, 0) : undefined,
    FixTash: settings.fixTash ? 'True' : undefined,
    tashType: settings.tashType || undefined,
    tmp: settings.template || undefined,
    hideBtns: settings.hideButtons ? 'True' : undefined,
    ClientName: ci.firstName || '',
    ClientLName: ci.lastName || '',
    email: ci.email || '',
    phone: phoneDigits || '',
    cell: mobileDigits || '',
    city: addr.city || '',
    street: addr.street || '',
    zip: addr.zip || addr.postalCode || ''
  };

  Object.keys(params).forEach((k) => {
    if (params[k] === undefined || params[k] === null || params[k] === '') delete params[k];
  });

  return params;
}

function parseHypayQueryString(raw) {
  const text = String(raw || '').trim().replace(/^\?/, '');
  const params = new URLSearchParams(text);
  const obj = {};
  for (const [k, v] of params.entries()) obj[k] = v;
  return { queryString: text, params: obj };
}

export async function createHypayPaymentUrl({ session, settings, overrides = {} }) {
  if (process.env.SKIP_DB === '1') {
    const qs = new URLSearchParams({
      action: 'pay',
      Amount: '10',
      Order: String(session?._id || 'mock'),
      Info: 'mock',
      signature: 'mocked'
    }).toString();
    return { url: `${DEFAULT_HOST}?${qs}`, payload: qs, parsed: { signature: 'mocked' } };
  }

  const params = buildBaseParams({ session, settings, overrides });
  const host = normalizeHost(settings?.host || DEFAULT_HOST);
  const resp = await axios.get(host, {
    params,
    timeout: 15000,
    validateStatus: () => true
  });

  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`hypay_sign_failed_${resp.status}`);
    err.status = resp.status;
    err.payload = resp.data;
    throw err;
  }

  const body = typeof resp.data === 'string' ? resp.data : resp?.data?.toString?.() || '';
  const { queryString, params: parsed } = parseHypayQueryString(body);
  if (!parsed.signature) {
    const err = new Error('hypay_signature_missing');
    err.status = 400;
    err.payload = body;
    throw err;
  }

  const url = `${host}?${queryString}`.replace(/\?\?+/, '?');
  return { url, payload: queryString, parsed };
}

export async function createHypayWalletCharge({ session, settings, walletToken, platform }) {
  if (!settings?.masof || !settings?.passp) {
    const err = new Error('hypay_missing_credentials');
    err.status = 412;
    throw err;
  }

  const { cardChargeAmount } = buildAmount(session);
  if (!(cardChargeAmount > 0)) {
    const err = new Error('hypay_invalid_amount');
    err.status = 400;
    throw err;
  }

  const ci = session?.customerInfo || {};
  const addr = session?.shippingAddress || {};
  const mobileDigits = String(ci.mobile || '').replace(/\D/g, '');
  const phoneDigits = String(ci.secondaryMobile || '').replace(/\D/g, '');

  const walletPayload = typeof walletToken === 'string' ? walletToken : JSON.stringify(walletToken || {});
  const host = normalizeHost(process.env.HYPAY_WALLET_HOST || settings?.host || DEFAULT_HOST);

  const params = {
    action: 'soft',
    Masof: settings.masof,
    KEY: settings.apiKey || undefined,
    PassP: settings.passp,
    Amount: cardChargeAmount,
    Coin: mapCurrencyToCoin(session?.currency),
    Info: settings.info || 'Online order',
    Order: session?.reference || String(session?._id || ''),
    MoreData: settings.moreData ? 'True' : undefined,
    UTF8: 'True',
    UTF8out: 'True',
    Tash: normalizeNumber(settings.tash, 0) > 0 ? normalizeNumber(settings.tash, 0) : undefined,
    FixTash: settings.fixTash ? 'True' : undefined,
    tashType: settings.tashType || undefined,
    PageLang: normalizeLang(settings.pageLang) || undefined,
    ClientName: ci.firstName || '',
    ClientLName: ci.lastName || '',
    email: ci.email || '',
    phone: phoneDigits || '',
    cell: mobileDigits || '',
    city: addr.city || '',
    street: addr.street || '',
    zip: addr.zip || addr.postalCode || '',
    WalletToken: walletPayload,
    platform
  };

  Object.keys(params).forEach((k) => {
    if (params[k] === undefined || params[k] === null || params[k] === '') delete params[k];
  });

  const resp = await axios.get(host, { params, timeout: 15000, validateStatus: () => true });
  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`hypay_wallet_failed_${resp.status}`);
    err.status = resp.status;
    err.payload = resp.data;
    throw err;
  }

  const body = typeof resp.data === 'string' ? resp.data : resp?.data?.toString?.() || '';
  const { params: parsed, queryString } = parseHypayQueryString(body);
  const code = parsed.CCode || parsed.ccode;
  const ok = String(code) === '0';

  return { ok, parsed, queryString, raw: body };
}

export async function verifyHypayPayment({ payload, settings }) {
  const params = payload || {};
  const Id = params.Id || params.id;
  const CCode = params.CCode || params.ccode;
  if (!Id || typeof params.Sign === 'undefined') {
    const err = new Error('hypay_missing_params');
    err.status = 400;
    throw err;
  }

  const verifyParams = {
    action: 'APISign',
    What: 'VERIFY',
    KEY: settings.apiKey,
    PassP: settings.passp,
    Masof: settings.masof,
    ...params
  };

  const host = normalizeHost(settings?.host || DEFAULT_HOST);
  const resp = await axios.get(host, { params: verifyParams, timeout: 15000, validateStatus: () => true });
  if (resp.status < 200 || resp.status >= 300) {
    const err = new Error(`hypay_verify_failed_${resp.status}`);
    err.status = resp.status;
    throw err;
  }
  const body = typeof resp.data === 'string' ? resp.data : resp?.data?.toString?.() || '';
  const { params: parsed, queryString } = parseHypayQueryString(body || new URLSearchParams(verifyParams).toString());
  const code = parsed.CCode || parsed.ccode || CCode;
  const ok = String(code) === '0';
  return { ok, parsed, queryString, raw: body };
}

export default {
  loadHypaySettings,
  createHypayPaymentUrl,
  verifyHypayPayment,
  createHypayWalletCharge,
  buildAmount
};
