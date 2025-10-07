export async function fetchWithTimeout(
  url: string,
  init: RequestInit = {},
  timeoutMs = 20000
): Promise<Response> {
  const controller = new AbortController();
  const id = setTimeout(() => {
    const reason = new Error(`Fetch to ${url} timed out after ${timeoutMs}ms`);
    controller.abort(reason as any);
  }, timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      const message = typeof error?.message === 'string' && error.message.trim() !== ''
        ? error.message
        : `Fetch to ${url} was aborted`;
      const timeoutError = new Error(message);
      timeoutError.name = 'AbortError';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(id);
  }
}
