const DEFAULT_RETRYABLE_STATUSES = [429, 500, 502, 503];
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 10_000;
const DEFAULT_MAX_TOTAL_DELAY_MS = 20_000;

function parseRetryAfterMs(headerValue) {
  if (!headerValue) return null;
  const trimmed = String(headerValue).trim();

  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const parsedDate = Date.parse(trimmed);
  if (!Number.isNaN(parsedDate)) return Math.max(0, parsedDate - Date.now());

  return null;
}

function backoffWithJitter(attempt, baseDelayMs) {
  const base = baseDelayMs * attempt;
  return Math.round(base * (0.5 + Math.random()));
}

export async function fetchWithRetry(url, fetchOptions = {}, retryOptions = {}) {
  const {
    retryableStatuses = DEFAULT_RETRYABLE_STATUSES,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    baseDelayMs = DEFAULT_BASE_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    maxTotalDelayMs = DEFAULT_MAX_TOTAL_DELAY_MS,
    debug = false
  } = retryOptions;

  let totalDelayMs = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const response = await fetch(url, fetchOptions);

    if (response.ok || !retryableStatuses.includes(response.status)) return response;
    if (attempt === maxAttempts) return response;

    const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
    let delayMs = Math.min(
      retryAfterMs !== null ? retryAfterMs : backoffWithJitter(attempt, baseDelayMs),
      maxDelayMs
    );

    if (totalDelayMs + delayMs > maxTotalDelayMs) {
      if (debug) console.log(`[fetchWithRetry] retry budget exhausted (${totalDelayMs}ms used) for ${url}`);
      return response;
    }

    if (debug) {
      console.log(
        `[fetchWithRetry] attempt ${attempt}/${maxAttempts} got ${response.status} for ${url}, ` +
        `retrying in ${delayMs}ms${retryAfterMs !== null ? " (honoring Retry-After)" : ""}`
      );
    }

    totalDelayMs += delayMs;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }

  throw new Error(`fetchWithRetry exhausted attempts for ${url}`);
}
