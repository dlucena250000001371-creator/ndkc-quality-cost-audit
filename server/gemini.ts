import { GoogleGenAI, type GenerateContentParameters } from '@google/genai';

const MODEL_LADDER = [
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
  'gemini-flash-latest',
  'gemini-3.7-flash',
  'gemini-4-hydrogen',
] as const;

const PER_ATTEMPT_TIMEOUT_MS = 45_000;
const QUOTA_COOLDOWN_MS = 10 * 60 * 1000;
const ROUND_DELAYS_MS = [0, 2000, 5000];

const rateLimitedUntil = new Map<string, number>();

export class AiServiceUnavailableError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 503, code = 'AI_UNAVAILABLE') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function isForceModelFailureEnabled(): boolean {
  return (process.env.FORCE_MODEL_FAILURE || '').trim().toLowerCase() === 'true';
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AiServiceUnavailableError(
      'The AI service is unavailable. Please tell the administrator.',
      503,
      'AI_KEY_MISSING'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function extractHttpStatus(err: unknown): number | null {
  if (!err || typeof err !== 'object') return null;
  const anyErr = err as Record<string, unknown>;
  if (typeof anyErr.status === 'number') return anyErr.status;
  if (typeof anyErr.code === 'number') return anyErr.code;
  const msg = err instanceof Error ? err.message : String(err);
  const match = msg.match(/\b(400|402|403|404|429|500|503)\b/);
  return match ? Number(match[1]) : null;
}

function isTimeoutError(err: unknown): boolean {
  if (!err) return false;
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('MODEL_ATTEMPT_TIMEOUT') || msg.toLowerCase().includes('timeout') || msg.toLowerCase().includes('aborted');
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callWithTimeout<T>(fn: () => Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      fn(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error('MODEL_ATTEMPT_TIMEOUT')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function generateContentWithFallback(
  params: Omit<GenerateContentParameters, 'model'>
): Promise<{ text: string; modelUsed: string }> {
  const ai = getGenAIClient();
  const forcePrimaryFail = isForceModelFailureEnabled();

  for (let roundIdx = 0; roundIdx < ROUND_DELAYS_MS.length; roundIdx++) {
    const delay = ROUND_DELAYS_MS[roundIdx];
    if (delay > 0) {
      await sleep(delay);
    }
    const round = roundIdx + 1;

    for (let i = 0; i < MODEL_LADDER.length; i++) {
      const model = MODEL_LADDER[i];
      const cooldownUntil = rateLimitedUntil.get(model);
      if (cooldownUntil && Date.now() < cooldownUntil) {
        console.log(`[fallback] round=${round} model=${model} status=skipped_429_cooldown`);
        continue;
      }

      try {
        if (forcePrimaryFail && i === 0) {
          const simErr = new Error('Simulated 503 UNAVAILABLE via FORCE_MODEL_FAILURE') as Error & { status?: number };
          simErr.status = 503;
          throw simErr;
        }

        const response = await callWithTimeout(
          () => ai.models.generateContent({ ...params, model }),
          PER_ATTEMPT_TIMEOUT_MS
        );

        const text = (response.text ?? '').trim();
        console.log(`[fallback] round=${round} model=${model} status=success`);
        return { text, modelUsed: model };
      } catch (err) {
        const status = extractHttpStatus(err);
        const timedOut = isTimeoutError(err);

        if (status === 402 || status === 403) {
          console.log(`[fallback] round=${round} model=${model} status=${status}_fatal`);
          throw new AiServiceUnavailableError(
            'The AI service is unavailable. Please tell the administrator.',
            status,
            'AI_FORBIDDEN_OR_BILLING'
          );
        }

        const recoverable =
          status === 503 || status === 429 || status === 404 || status === 500 || timedOut;

        if (!recoverable) {
          console.log(`[fallback] round=${round} model=${model} status=${status ?? 'non_recoverable'}_stop`);
          throw new AiServiceUnavailableError(
            'Unable to process this request with the AI service.',
            status && status >= 400 && status < 500 ? status : 502,
            'AI_REQUEST_REJECTED'
          );
        }

        if (status === 429) {
          rateLimitedUntil.set(model, Date.now() + QUOTA_COOLDOWN_MS);
        }

        console.log(
          `[fallback] round=${round} model=${model} status=${timedOut ? 'timeout_45s' : status}_recoverable`
        );
      }
    }
  }

  throw new AiServiceUnavailableError(
    'The server is busy. Click Retry.',
    503,
    'AI_ALL_MODELS_FAILED'
  );
}
