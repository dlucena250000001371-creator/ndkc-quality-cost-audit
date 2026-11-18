export class ApiRequestError extends Error {
  status: number;
  code: string;
  requestId?: string;

  constructor(message: string, status: number, code = 'API_ERROR', requestId?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.requestId = requestId;
  }
}

export async function apiFetch<T>(
  url: string,
  idToken: string,
  options: { method?: 'GET' | 'POST'; body?: unknown } = {}
): Promise<T> {
  const { method = 'GET', body } = options;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${idToken}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiRequestError('Network error. Please check your connection and try again.', 0, 'NETWORK_ERROR');
  }

  if (response.status === 502 || response.status === 504) {
    throw new ApiRequestError('The server is busy. Click Retry.', response.status, 'SERVER_BUSY');
  }

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new ApiRequestError('The server is busy. Click Retry.', response.status || 502, 'NON_JSON_RESPONSE');
  }

  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ApiRequestError('The server is busy. Click Retry.', response.status || 502, 'INVALID_JSON');
  }

  if (!response.ok) {
    const errObj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
    const message =
      typeof errObj.error === 'string' && errObj.error
        ? errObj.error
        : 'Request failed. Please try again.';
    const code = typeof errObj.code === 'string' ? errObj.code : 'API_ERROR';
    const requestId = typeof errObj.requestId === 'string' ? errObj.requestId : undefined;
    throw new ApiRequestError(message, response.status, code, requestId);
  }

  return data as T;
}
