/**
 * The single HTTP client.
 *
 * Every network call in the app goes through here, which is what makes three
 * things possible in one place: attaching the access token, recovering from an
 * expired one without the user noticing, and turning every failure into the
 * same shape the UI knows how to render.
 *
 * The access token is held in memory only. It is never written to
 * localStorage, so an XSS bug cannot read it out of storage at leisure. The
 * refresh token is an HttpOnly cookie the browser sends on its own and
 * JavaScript cannot touch at all.
 */

const BASE_URL = import.meta.env.VITE_API_URL || '/api/v1';

let accessToken = null;
let onUnauthenticated = null;

/** In-flight refresh, shared so ten parallel 401s trigger one refresh. */
let refreshPromise = null;

export function setAccessToken(token) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

/** Called when the session is truly gone, so the app can send the user to sign in. */
export function setUnauthenticatedHandler(handler) {
  onUnauthenticated = handler;
}

/** The error every failed request throws. Carries enough for the UI to be specific. */
export class ApiError extends Error {
  constructor(message, { status, code, details, requestId } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }

  /** Field-level messages, keyed for react-hook-form's setError. */
  get fieldErrors() {
    if (!Array.isArray(this.details)) return {};
    return this.details.reduce((acc, d) => {
      if (!d.field) return acc;
      // The API namespaces fields as "body.email"; forms know them as "email".
      const name = d.field.replace(/^(body|query|params)\./, '');
      acc[name] = d.message;
      return acc;
    }, {});
  }

  get isValidation() {
    return this.status === 422 || this.code === 'VALIDATION_FAILED';
  }

  get isAuth() {
    return this.status === 401;
  }

  get isForbidden() {
    return this.status === 403;
  }

  get isNotFound() {
    return this.status === 404;
  }

  get isConflict() {
    return this.status === 409;
  }
}

async function parse(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

/**
 * A response with no `error` envelope did not come from the API.
 *
 * In practice that means something answered on its behalf - the dev proxy
 * while the server restarts, or a gateway in front of it. Saying "try again"
 * without saying why sends people hunting for a bug in their own input, when
 * the honest answer is that nothing was reached.
 */
function toError(response, body) {
  const error = body?.error;

  if (!error?.message) {
    return new ApiError(
      'Could not reach the ServiceMitra server. If it is restarting, wait a moment and try again.',
      { status: response.status, code: 'UPSTREAM_UNAVAILABLE' },
    );
  }

  return new ApiError(error.message, {
    status: response.status,
    code: error.code,
    details: error.details,
    requestId: body?.requestId,
  });
}

/**
 * Exchanges the refresh cookie for a new access token.
 *
 * Concurrent callers share one attempt: without that, a dashboard firing five
 * queries at once would send five refreshes, and rotation means four of them
 * would be rejected as replays and log the user out.
 */
async function refreshSession() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch(BASE_URL + '/auth/refresh', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!response.ok) return null;

      const body = await parse(response);
      const token = body?.data?.accessToken ?? null;
      if (token) accessToken = token;
      return body?.data ?? null;
    } catch {
      return null;
    } finally {
      // Cleared on the next tick so callers awaiting this one still see it.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

export { refreshSession };

/**
 * Performs a request, retrying once after a silent refresh if the access
 * token had expired. `skipRefresh` stops the sign-in and refresh calls from
 * recursing into themselves.
 */
async function request(method, path, { body, params, signal, skipRefresh = false, isRetry = false } = {}) {
  const url = new URL(
    BASE_URL + path,
    BASE_URL.startsWith('http') ? undefined : window.location.origin,
  );

  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue;
      if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, v));
      else url.searchParams.set(key, String(value));
    }
  }

  const headers = { Accept: 'application/json' };
  const isFormData = body instanceof FormData;

  // Let the browser set the multipart boundary itself.
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = 'Bearer ' + accessToken;

  let response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      credentials: 'include',
      signal,
      body: body === undefined ? undefined : isFormData ? body : JSON.stringify(body),
    });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ApiError('Cannot reach ServiceMitra. Check your connection and try again.', {
      status: 0,
      code: 'NETWORK_ERROR',
    });
  }

  if (response.status === 204) return null;

  const payload = await parse(response);

  if (response.ok) return payload?.data !== undefined ? payload : { data: payload };

  // An expired access token is recoverable: refresh once, then replay.
  const expired = response.status === 401 && !skipRefresh && !isRetry;

  if (expired) {
    const refreshed = await refreshSession();
    if (refreshed?.accessToken) {
      return request(method, path, { body, params, signal, isRetry: true });
    }

    accessToken = null;
    if (onUnauthenticated) onUnauthenticated();
  }

  throw toError(response, payload);
}

export const api = {
  get: (path, options) => request('GET', path, options),
  post: (path, body, options) => request('POST', path, { ...options, body }),
  put: (path, body, options) => request('PUT', path, { ...options, body }),
  patch: (path, body, options) => request('PATCH', path, { ...options, body }),
  delete: (path, options) => request('DELETE', path, options),

  /** Uploads a file without a JSON content type getting in the way. */
  upload: (path, formData, options) => request('POST', path, { ...options, body: formData }),

  /**
   * Downloads a file the signed-in user is entitled to.
   *
   * A plain <a download> cannot carry the access token - it lives in memory,
   * deliberately, so that an XSS bug cannot read it out of storage. So the
   * file is fetched with the header attached and handed to the browser as a
   * blob instead.
   */
  async download(path, { params, filename } = {}) {
    const url = new URL(
      BASE_URL + path,
      BASE_URL.startsWith('http') ? undefined : window.location.origin,
    );

    for (const [key, value] of Object.entries(params ?? {})) {
      if (value === undefined || value === null || value === '') continue;
      url.searchParams.set(key, String(value));
    }

    // Refresh first rather than after a 401: a failed download is invisible
    // until the user notices nothing arrived, so it is worth one extra call.
    if (!accessToken) await refreshSession();

    const response = await fetch(url.toString(), {
      credentials: 'include',
      headers: accessToken ? { Authorization: 'Bearer ' + accessToken } : {},
    });

    if (!response.ok) throw toError(response, await parse(response));

    // The server names the file; the caller's name is only a fallback.
    const disposition = response.headers.get('content-disposition') ?? '';
    const named = /filename="?([^";]+)"?/.exec(disposition);

    const blob = await response.blob();
    const href = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = href;
    link.download = named ? named[1] : filename || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();

    // Revoked on the next tick: revoking synchronously can cancel the download
    // in some browsers before it has read the blob.
    setTimeout(() => URL.revokeObjectURL(href), 0);

    return true;
  },
};

/**
 * Opens a server-sent events stream.
 *
 * EventSource cannot send an Authorization header, so the token rides as a
 * query parameter. That is acceptable only because these URLs are never
 * logged by the API and the token is short-lived - and the alternative,
 * polling a live job every second, is worse for both sides.
 */
export function openStream(path, { onEvent, onError } = {}) {
  const url = new URL(
    BASE_URL + path,
    BASE_URL.startsWith('http') ? undefined : window.location.origin,
  );

  const source = new EventSource(url.toString(), { withCredentials: true });

  const handler = (event) => {
    try {
      onEvent?.(event.type, JSON.parse(event.data));
    } catch {
      // A malformed frame is not worth tearing the stream down for.
    }
  };

  for (const type of [
    'snapshot', 'connected',
    'booking.started', 'booking.completed', 'booking.completion_requested',
  ]) {
    source.addEventListener(type, handler);
  }

  source.onerror = (err) => {
    // EventSource reconnects on its own; this is for surfacing a stuck stream.
    onError?.(err);
  };

  return () => source.close();
}

export default api;
