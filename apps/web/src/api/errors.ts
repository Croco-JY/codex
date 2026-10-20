const messages: Record<number, string> = {
  0: "Check your connection and try again.",
  400: "Check the entered values and try again.",
  401: "Authenticate to continue.",
  403: "You do not have access to this workspace.",
  404: "The requested resource could not be found.",
  409: "This information has changed. Reload it before trying again.",
};

/** Holds only safe, bounded display fields. Never retains a request or server payload. */
export class ApiError extends Error {
  readonly requestId?: string;
  constructor(
    readonly status: number,
    requestId?: string,
  ) {
    super(
      messages[status] ?? "The service is temporarily unavailable. Try again.",
    );
    this.name = "ApiError";
    this.requestId = safeRequestId(requestId);
  }
}

export function safeRequestId(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(value)
    ? value
    : undefined;
}

// Bound the actual stream as well as declared Content-Length. Error bodies are untrusted.
async function problemReference(
  response: Response,
): Promise<string | undefined> {
  const type = response.headers
    .get("Content-Type")
    ?.split(";")[0]
    ?.trim()
    .toLowerCase();
  if (type !== "application/problem+json" && type !== "application/json")
    return;
  if (Number(response.headers.get("Content-Length")) > 8192 || !response.body)
    return;
  const reader = response.body.getReader();
  try {
    let size = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8192) return;
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    const problem: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (problem && typeof problem === "object" && "requestId" in problem)
      return safeRequestId(problem.requestId);
  } catch {
    // Keep the original HTTP status even if the body is missing or malformed.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function responseError(response: Response): Promise<ApiError> {
  const header = safeRequestId(response.headers.get("X-Request-ID"));
  try {
    return new ApiError(
      response.status,
      header ?? (await problemReference(response)),
    );
  } catch {
    return new ApiError(response.status, header);
  }
}

export function errorView(error: unknown) {
  const safe = error instanceof ApiError ? error : new ApiError(500);
  const title =
    (
      {
        0: "Connection unavailable",
        400: "Check your input",
        401: "Authentication required",
        403: "Access denied",
        404: "Not found",
        409: "Reload required",
      } as Record<number, string>
    )[safe.status] ?? "Service unavailable";
  return {
    title,
    message: safe.message,
    requestId: safe.requestId,
    retryable: safe.status === 0 || safe.status >= 500,
  };
}

export function retryRead(failureCount: number, error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.status === 0 || error.status >= 500) &&
    failureCount < 1
  );
}

// Background freshness must not become a retry loop for a terminal client error.
export function canRefreshRead(error: unknown): boolean {
  return (
    error == null ||
    (error instanceof ApiError && (error.status === 0 || error.status >= 500))
  );
}
