export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Calls the NestJS API through the /api rewrite. Throws ApiError on non-2xx. */
let redirecting = false;

export async function api<T = unknown>(
  path: string,
  init: Omit<RequestInit, "body"> & { body?: unknown } = {},
): Promise<T> {
  const { body, headers, ...rest } = init;
  // FormData (file uploads) goes as multipart; the browser sets the boundary header.
  const isForm = typeof FormData !== "undefined" && body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    ...rest,
    credentials: "same-origin",
    headers: { ...(body !== undefined && !isForm ? { "Content-Type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  });

  if (res.status === 401 && typeof window !== "undefined" && !path.startsWith("/auth/login")) {
    // Drop the rejected cookie first; otherwise /login sees it and sends us back here in a loop.
    if (!redirecting) {
      redirecting = true;
      await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" }).catch(() => undefined);
      window.location.replace(`/login?next=${encodeURIComponent(window.location.pathname)}`);
    }
  }
  if (!res.ok) {
    let message = res.statusText;
    try {
      const data = await res.json();
      message = Array.isArray(data.message) ? data.message.join("، ") : (data.message ?? message);
    } catch {
      /* not JSON */
    }
    throw new ApiError(res.status, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

const numberFormat = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
export const formatNumber = (n: number | null | undefined) => numberFormat.format(n ?? 0);
