/**
 * Centralized API Service for secure fetch requests with response validation
 * and clean error handling to prevent JSON parsing crashes when servers return HTML.
 */

export class ApiError extends Error {
  status: number;
  statusText: string;
  bodyText: string;

  constructor(message: string, status: number, statusText: string, bodyText: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.bodyText = bodyText;
  }
}

export interface FetchOptions extends RequestInit {
  timeout?: number; // Timeout in milliseconds
  retries?: number; // Number of retries on network/server failures
}

const DEFAULT_TIMEOUT = 15000; // 15 seconds
const DEFAULT_RETRIES = 2;

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function request<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const { timeout = DEFAULT_TIMEOUT, retries = DEFAULT_RETRIES, ...initOpts } = options;
  const headers = new Headers(initOpts.headers || {});
  
  // Set default Content-Type to JSON if sending a body and not already set
  if (initOpts.body && !headers.has("Content-Type") && !(initOpts.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let attempt = 0;
  let lastError: any = null;

  while (attempt <= retries) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
      if (attempt > 0) {
        console.warn(`[API RETRY] Attempt ${attempt}/${retries} for ${initOpts.method || "GET"} ${url}`);
        // Exponential backoff
        await delay(Math.pow(2, attempt) * 500);
      }

      console.log(`[API REQUEST] ${initOpts.method || "GET"} ${url} (Attempt ${attempt + 1})`);

      const response = await fetch(url, { 
        ...initOpts, 
        headers, 
        signal: controller.signal 
      });

      clearTimeout(id);

      const contentType = response.headers.get("content-type") || "";
      const isJson = contentType.includes("application/json");

      let responseBodyText = "";
      try {
        responseBodyText = await response.text();
      } catch (e: any) {
        console.error(`[API ERROR] Gagal membaca teks respons dari ${url}:`, e);
        throw new ApiError(
          `Gagal membaca teks respons dari server: ${e.message}`,
          response.status,
          response.statusText,
          ""
        );
      }

      // Handle non-2xx successful responses
      if (!response.ok) {
        let errorMessage = `Permintaan API gagal dengan status ${response.status} (${response.statusText})`;
        
        if (isJson && responseBodyText) {
          try {
            const jsonError = JSON.parse(responseBodyText);
            errorMessage = jsonError.error || jsonError.message || errorMessage;
          } catch (_) {
            // Fallback to raw text if JSON parse fails
          }
        } else if (responseBodyText) {
          // Check for HTML or other text snippets to give helpful diagnostic errors
          const snippet = responseBodyText.substring(0, 150).trim();
          errorMessage = `Server Error (${response.status}): ${snippet}...`;
        }

        console.error(`[API SERVER ERROR] ${initOpts.method || "GET"} ${url} -> Status ${response.status}:`, {
          status: response.status,
          statusText: response.statusText,
          url,
          bodySnippet: responseBodyText.substring(0, 300)
        });

        // Retry on rate limit (429) or server errors (5xx), but not client errors (4xx except 429)
        if (response.status >= 500 || response.status === 429) {
          throw new ApiError(errorMessage, response.status, response.statusText, responseBodyText);
        } else {
          // Non-retryable client error
          throw new ApiError(errorMessage, response.status, response.statusText, responseBodyText);
        }
      }

      // Handle successful responses that are not JSON when we expect JSON
      if (!isJson) {
        const snippet = responseBodyText.substring(0, 150).trim();
        const errorMsg = `Server mengembalikan format '${contentType || "text/plain"}' bukan JSON. Potongan respons: "${snippet}"`;
        
        console.error(`[API VALIDATION ERROR] Mengharapkan JSON dari ${url} tetapi menerima:`, {
          contentType,
          snippet,
          fullBody: responseBodyText
        });

        throw new ApiError(errorMsg, response.status, response.statusText, responseBodyText);
      }

      // Parse JSON securely
      try {
        return JSON.parse(responseBodyText) as T;
      } catch (err: any) {
        console.error(`[API PARSE ERROR] Gagal mengurai respons JSON dari ${url}:`, err, {
          body: responseBodyText
        });
        throw new ApiError(
          `Gagal mengurai respons sebagai JSON: ${err.message}. Potongan konten: "${responseBodyText.substring(0, 100)}"`,
          response.status,
          response.statusText,
          responseBodyText
        );
      }

    } catch (err: any) {
      clearTimeout(id);
      
      // Determine if it was a timeout abort
      if (err.name === 'AbortError') {
        err = new ApiError(
          `Permintaan dibatalkan karena melebihi batas waktu (timeout ${timeout}ms)`,
          408,
          "Request Timeout",
          "Timeout"
        );
      }

      console.error(`[API ERROR OCCURRED] ${initOpts.method || "GET"} ${url}:`, err.message || err);
      lastError = err;

      // Only retry on network errors, timeouts, rate limits, or 5xx server errors
      const isRetryableStatus = err instanceof ApiError && (err.status >= 500 || err.status === 429 || err.status === 408);
      const isNetworkError = !(err instanceof ApiError) || err.status === 0;

      if (isRetryableStatus || isNetworkError) {
        attempt++;
      } else {
        // Break early if it's a standard 4xx client error (unauthorized, bad request, forbidden, etc.)
        break;
      }
    }
  }

  throw lastError || new ApiError(`Permintaan gagal setelah ${retries} percobaan.`, 500, "Internal Error", "");
}

export const api = {
  get: <T>(url: string, options?: FetchOptions) => 
    request<T>(url, { ...options, method: "GET" }),
    
  post: <T>(url: string, body?: any, options?: FetchOptions) => 
    request<T>(url, { 
      ...options, 
      method: "POST", 
      body: body instanceof FormData ? body : JSON.stringify(body) 
    }),
    
  put: <T>(url: string, body?: any, options?: FetchOptions) => 
    request<T>(url, { 
      ...options, 
      method: "PUT", 
      body: body instanceof FormData ? body : JSON.stringify(body) 
    }),
    
  delete: <T>(url: string, options?: FetchOptions) => 
    request<T>(url, { ...options, method: "DELETE" })
};
