import { GoogleGenAI } from '@google/genai';

const API_KEY = import.meta.env.VITE_API_KEY || import.meta.env.VITE_GEMINI_API_KEY;
if (!API_KEY) {
  console.error('Missing API key: set VITE_API_KEY or VITE_GEMINI_API_KEY in your .env');
}

const ai = new GoogleGenAI({ apiKey: API_KEY });

const generationConfig = {
  temperature: 1,
  maxOutputTokens: 600,
  topP: 0.95,
};

const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
const MAX_RETRIES = 8;
const BASE_DELAY_MS = 1000;
const MAX_BACKOFF_MS = 60_000; // cap exponential backoff
const MODEL_FALLBACKS = ['gemini-2.5-flash', 'gemini-3-flash-preview'];

// Simple client-side concurrency limiter to avoid sending too many parallel requests
const MAX_CONCURRENT_REQUESTS = 1;
let _runningRequests = 0;
const _requestQueue = [];
let _cooldownUntil = 0; // timestamp (ms) until which new requests should wait
const MIN_INTERVAL_MS = Number(import.meta.env.VITE_API_MIN_INTERVAL_MS) || 3000; // min gap between requests
let _lastRequestTime = 0;

function enqueueRequest(fn) {
  return new Promise((resolve, reject) => {
    const run = async () => {
      _runningRequests += 1;
      try {
        // If we're in cooldown due to recent 429s, wait until cooldown expires
        const now = Date.now();
        if (_cooldownUntil > now) {
          const waitMs = _cooldownUntil - now;
          console.warn(`In cooldown; delaying request ${waitMs}ms`);
          await delay(waitMs);
        }

        // Ensure a minimum interval between requests
        const sinceLast = Date.now() - _lastRequestTime;
        if (_lastRequestTime && sinceLast < MIN_INTERVAL_MS) {
          const waitMs = MIN_INTERVAL_MS - sinceLast;
          await delay(waitMs);
        }

        const r = await fn();
        _lastRequestTime = Date.now();
        resolve(r);
      } catch (err) {
        reject(err);
      } finally {
        _runningRequests -= 1;
        if (_requestQueue.length > 0) {
          const next = _requestQueue.shift();
          next();
        }
      }
    };

    if (_runningRequests < MAX_CONCURRENT_REQUESTS) {
      run();
    } else {
      _requestQueue.push(run);
      console.warn('API request queued; queue length', _requestQueue.length);
    }
  });
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getErrorStatus(error) {
  if (!error || typeof error !== 'object') {
    return null;
  }
  return error.status || (error.error && error.error.code) || null;
}

function isRetryableError(error) {
  const status = getErrorStatus(error);
  return status !== null && RETRYABLE_STATUS_CODES.includes(status);
}

function getRetryAfterMs(error) {
  if (!error || !error.headers) {
    return null;
  }
  const retryAfter = error.headers['retry-after'] || error.headers['Retry-After'];
  if (!retryAfter) {
    return null;
  }
  const value = Number(retryAfter);
  return Number.isFinite(value) ? value * 1000 : null;
}

async function generateWithRetry(model, prompt) {
  let attempt = 0;

  while (attempt < MAX_RETRIES) {
    try {
      const result = await enqueueRequest(() => ai.models.generateContent({
        model,
        contents: prompt,
        config: generationConfig,
      }));
      return result.text;
    } catch (error) {
      attempt += 1;
      const status = getErrorStatus(error);
      if (!isRetryableError(error) || attempt >= MAX_RETRIES) {
        throw error;
      }
      const retryAfterMs = getRetryAfterMs(error);
      const exponentialBackoff = Math.min(BASE_DELAY_MS * Math.pow(2, attempt - 1), MAX_BACKOFF_MS);
      const jitter = Math.floor(Math.random() * 1000);
      const wait = retryAfterMs || (exponentialBackoff + jitter);
      // If we received a 429, set a client-side cooldown to pause queued requests
      if (status === 429) {
        const cooldown = retryAfterMs || Math.min(exponentialBackoff * 2, MAX_BACKOFF_MS);
        _cooldownUntil = Date.now() + cooldown;
        console.warn(`Setting cooldown for ${cooldown}ms until ${new Date(_cooldownUntil).toISOString()}`);
      }
      console.warn(`Model ${model} retry ${attempt} after status ${status}; waiting ${wait}ms`);
      await delay(wait);
    }
  }
}

async function run(prompt) {
  let lastError;

  for (const model of MODEL_FALLBACKS) {
    try {
      if (model !== MODEL_FALLBACKS[0]) {
        console.warn(`Falling back to alternate model: ${model}`);
      }
      return await generateWithRetry(model, prompt);
    } catch (error) {
      lastError = error;
      const status = getErrorStatus(error);
      console.warn(`Model ${model} failed with status ${status || 'unknown'}; ${isRetryableError(error) ? 'trying next fallback' : 'stopping retries'}`);
      if (!isRetryableError(error)) {
        break;
      }
    }
  }

  throw lastError;
}

export default run;


