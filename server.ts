import 'dotenv/config';
import crypto from 'crypto';
import path from 'path';
import express, { type Request, type Response, type NextFunction } from 'express';
import { Type } from '@google/genai';
import { requireAuth, resolveAdminStatus, type AuthedRequest } from './server/auth.ts';
import {
  getFirestoreDoc,
  runCollectionGroupQuery,
  runUserSubcollectionQuery,
  FirestoreRestError,
} from './server/firestoreRest.ts';
import {
  AiServiceUnavailableError,
  generateContentWithFallback,
  isForceModelFailureEnabled,
} from './server/gemini.ts';
import {
  PROMPT_1_TEMPLATE,
  PROMPT_2_TEMPLATE,
  PROMPT_3_TEMPLATE,
  fillPromptTemplate,
} from './server/prompts.ts';
import {
  checkInterviewRateLimit,
  computeLedgerAggregates,
  extractBaselineCodes,
  formatBaselineText,
  isValidAuditId,
  isValidUuid,
  validateAndComputeCostSheet,
  validateProfileFields,
} from './server/validation.ts';
import {
  extractBaselineCodeTitles,
} from './shared/costMath.ts';
import {
  MAX_CHAT_MESSAGE_CHARS,
  buildWelcomeMessage,
  type BaselineDoc,
} from './src/types/audit.ts';

const PORT = 3000;

async function startServer() {
  console.log(`FORCE_MODEL_FAILURE is ${isForceModelFailureEnabled() ? 'ON' : 'OFF'}`);

  const app = express();

  // Top-level body parsing BEFORE any routes
  app.use(express.json({ limit: '1mb' }));

  // Request ID middleware
  app.use((req: AuthedRequest, _res: Response, next: NextFunction) => {
    req.requestId = crypto.randomUUID();
    next();
  });

  // 1. GET /api/me
  app.get('/api/me', requireAuth, async (req: AuthedRequest, res: Response) => {
    const requestId = req.requestId || 'unknown';
    const user = req.user!;
    try {
      const { isAdmin, adminSetupNeeded } = await resolveAdminStatus(user);
      res.json({
        uid: user.uid,
        displayName: user.displayName || 'NDKC Employee',
        isAdmin,
        adminSetupNeeded,
      });
    } catch {
      res.status(500).json({
        error: 'Failed to load account status.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  });

  // 2. POST /api/interview/reply
  app.post('/api/interview/reply', requireAuth, async (req: AuthedRequest, res: Response) => {
    const requestId = req.requestId || 'unknown';
    const user = req.user!;

    if (!checkInterviewRateLimit(user.uid)) {
      res.status(429).json({
        error: 'Too many requests. Please wait a few minutes and try again.',
        code: 'RATE_LIMITED',
        requestId,
      });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const auditId = body.auditId;
    const clientMessageId = body.clientMessageId;
    const rawMessage = body.message;

    if (!isValidAuditId(auditId)) {
      res.status(400).json({
        error: 'Invalid audit identifier.',
        code: 'INVALID_AUDIT_ID',
        requestId,
      });
      return;
    }
    if (!isValidUuid(clientMessageId)) {
      res.status(400).json({
        error: 'Invalid message identifier.',
        code: 'INVALID_MESSAGE_ID',
        requestId,
      });
      return;
    }
    if (typeof rawMessage !== 'string') {
      res.status(400).json({
        error: 'Message must be text.',
        code: 'INVALID_MESSAGE',
        requestId,
      });
      return;
    }
    const message = rawMessage.trim();
    if (message.length < 1 || message.length > MAX_CHAT_MESSAGE_CHARS) {
      res.status(400).json({
        error: `Message must be between 1 and ${MAX_CHAT_MESSAGE_CHARS} characters.`,
        code: 'INVALID_MESSAGE_LENGTH',
        requestId,
      });
      return;
    }

    try {
      const [profileDoc, baselineDoc, auditDoc, interactionDocs] = await Promise.all([
        getFirestoreDoc(`users/${user.uid}`, user.idToken),
        getFirestoreDoc('settings/qualityBaseline', user.idToken),
        getFirestoreDoc(`users/${user.uid}/costAudits/${auditId}`, user.idToken),
        runUserSubcollectionQuery(user.uid, 'interactions', 'auditId', auditId, user.idToken),
      ]);

      if (!profileDoc) {
        res.status(400).json({
          error: 'Please complete your employee profile before starting the interview.',
          code: 'PROFILE_REQUIRED',
          requestId,
        });
        return;
      }

      const profileErr = validateProfileFields(profileDoc);
      if (profileErr) {
        res.status(400).json({
          error: profileErr,
          code: 'INVALID_PROFILE',
          requestId,
        });
        return;
      }

      if (!auditDoc) {
        res.status(404).json({
          error: 'Audit session not found.',
          code: 'AUDIT_NOT_FOUND',
          requestId,
        });
        return;
      }

      const sortedInteractions = [...interactionDocs].sort((a, b) => {
        const ta = Date.parse(String(a.timestamp || '')) || 0;
        const tb = Date.parse(String(b.timestamp || '')) || 0;
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      const userMessages = sortedInteractions.filter((m) => m.role === 'user');
      const answerCount = userMessages.length;
      const closing = answerCount >= 7;
      const nextQuestion = closing ? 7 : answerCount + 1;

      const baselineDocs = Array.isArray(baselineDoc?.documents)
        ? (baselineDoc!.documents as BaselineDoc[])
        : [];
      const baselineText = formatBaselineText(baselineDocs);
      const today = new Date().toISOString().slice(0, 10);

      const progressInstruction = !closing
        ? `Now ask question ${nextQuestion}.`
        : 'The interview is complete. In two sentences, name the process and its most time-consuming failure, then tell the employee to click "Build Quality Cost Sheet". Ask no question.';

      const systemInstruction = fillPromptTemplate(PROMPT_1_TEMPLATE, {
        today,
        displayName: String(profileDoc.displayName || user.displayName || 'Employee'),
        office: String(profileDoc.office || ''),
        roleCategory: String(profileDoc.roleCategory || ''),
        position: String(profileDoc.position || ''),
        jobDescription: String(profileDoc.jobDescription || ''),
        yearsInRole: String(profileDoc.yearsInRole ?? 0),
        baselineText,
        answerCount: String(answerCount),
        progressInstruction,
      });

      // Build clean alternating multi-turn contents starting with a user turn
      const contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
      if (sortedInteractions.length > 0 && sortedInteractions[0].role === 'assistant') {
        contents.push({
          role: 'user',
          parts: [{ text: 'Begin the Quality Cost Audit interview.' }],
        });
      }

      for (const msg of sortedInteractions) {
        const role = msg.role === 'assistant' ? 'model' : 'user';
        const text = String(msg.content || '').trim();
        if (!text) continue;
        const last = contents[contents.length - 1];
        if (last && last.role === role) {
          last.parts[0].text += `\n\n${text}`;
        } else {
          contents.push({ role, parts: [{ text }] });
        }
      }

      // Ensure the latest user message is the final turn
      if (
        contents.length === 0 ||
        contents[contents.length - 1].role !== 'user'
      ) {
        contents.push({ role: 'user', parts: [{ text: message }] });
      }

      const { text: reply, modelUsed } = await generateContentWithFallback({
        contents,
        config: {
          systemInstruction,
        },
      });

      res.json({
        reply,
        questionNumber: nextQuestion,
        answerCount,
        closing,
        modelUsed,
      });
    } catch (err) {
      if (err instanceof AiServiceUnavailableError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          requestId,
        });
        return;
      }
      if (err instanceof FirestoreRestError) {
        res.status(err.status === 403 ? 403 : 502).json({
          error: 'Could not read your interview data.',
          code: 'FIRESTORE_READ_ERROR',
          requestId,
        });
        return;
      }
      res.status(500).json({
        error: 'An unexpected error occurred while generating the reply.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  });

  // 3. POST /api/interview/sheet
  app.post('/api/interview/sheet', requireAuth, async (req: AuthedRequest, res: Response) => {
    const requestId = req.requestId || 'unknown';
    const user = req.user!;

    if (!checkInterviewRateLimit(user.uid)) {
      res.status(429).json({
        error: 'Too many requests. Please wait a few minutes and try again.',
        code: 'RATE_LIMITED',
        requestId,
      });
      return;
    }

    const body = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>) : {};
    const auditId = body.auditId;
    if (!isValidAuditId(auditId)) {
      res.status(400).json({
        error: 'Invalid audit identifier.',
        code: 'INVALID_AUDIT_ID',
        requestId,
      });
      return;
    }

    try {
      const [profileDoc, baselineDoc, auditDoc, interactionDocs] = await Promise.all([
        getFirestoreDoc(`users/${user.uid}`, user.idToken),
        getFirestoreDoc('settings/qualityBaseline', user.idToken),
        getFirestoreDoc(`users/${user.uid}/costAudits/${auditId}`, user.idToken),
        runUserSubcollectionQuery(user.uid, 'interactions', 'auditId', auditId, user.idToken),
      ]);

      if (!profileDoc || !auditDoc) {
        res.status(404).json({
          error: 'Audit session or profile not found.',
          code: 'NOT_FOUND',
          requestId,
        });
        return;
      }

      const sortedInteractions = [...interactionDocs].sort((a, b) => {
        const ta = Date.parse(String(a.timestamp || '')) || 0;
        const tb = Date.parse(String(b.timestamp || '')) || 0;
        if (ta !== tb) return ta - tb;
        return String(a.id || '').localeCompare(String(b.id || ''));
      });

      const userAnswersCount = sortedInteractions.filter((m) => m.role === 'user').length;
      if (userAnswersCount < 5) {
        res.status(400).json({
          error: 'Please answer at least 5 interview questions before building the Quality Cost Sheet.',
          code: 'INSUFFICIENT_ANSWERS',
          requestId,
        });
        return;
      }

      const baselineDocs = Array.isArray(baselineDoc?.documents)
        ? (baselineDoc!.documents as BaselineDoc[])
        : [];
      const baselineText = formatBaselineText(baselineDocs);
      const validCodes = extractBaselineCodes(baselineDocs);

      const profileSummary = [
        `Name: ${String(profileDoc.displayName || '')}`,
        `Department or office: ${String(profileDoc.office || '')}`,
        `Role category: ${String(profileDoc.roleCategory || '')}`,
        `Position: ${String(profileDoc.position || '')}`,
        `Job description: ${String(profileDoc.jobDescription || '')}`,
        `Years in role: ${String(profileDoc.yearsInRole ?? 0)}`,
      ].join('\n');

      let userAnswersSeen = 0;
      const transcript = sortedInteractions
        .map((m) => {
          const speaker = m.role === 'assistant' ? 'Audit Partner' : 'Employee';
          let qTag = '';
          if (m.role === 'assistant') {
            qTag = userAnswersSeen >= 7 ? ' [Closing]' : m.questionNumber ? ` [Q${m.questionNumber}]` : '';
          } else {
            userAnswersSeen++;
            qTag = m.questionNumber ? ` [Q${m.questionNumber}]` : '';
          }
          return `${speaker}${qTag}: ${String(m.content || '')}`;
        })
        .join('\n\n');

      const auditDate = String(auditDoc.createdAt || new Date().toISOString()).slice(0, 10);

      const promptText = fillPromptTemplate(PROMPT_2_TEMPLATE, {
        profile: profileSummary,
        baselineText,
        transcript,
        auditDate,
      });

      const statedCategorySchema = {
        type: Type.OBJECT,
        properties: {
          hours: { type: Type.NUMBER, nullable: true },
          said: { type: Type.STRING },
          peakNote: { type: Type.STRING },
        },
        required: ['hours', 'said', 'peakNote'],
      };

      const { text: jsonText, modelUsed } = await generateContentWithFallback({
        contents: promptText,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              processName: { type: Type.STRING },
              processCode: { type: Type.STRING },
              summary: { type: Type.STRING },
              statedHours: {
                type: Type.OBJECT,
                properties: {
                  prevention: statedCategorySchema,
                  appraisal: statedCategorySchema,
                  internalFailure: statedCategorySchema,
                  externalFailure: statedCategorySchema,
                },
                required: ['prevention', 'appraisal', 'internalFailure', 'externalFailure'],
              },
              activities: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    category: {
                      type: Type.STRING,
                      enum: ['Prevention', 'Appraisal', 'Internal Failure', 'External Failure'],
                    },
                    activity: { type: Type.STRING },
                    hoursPerWeek: { type: Type.NUMBER, nullable: true },
                    peakOnly: { type: Type.BOOLEAN },
                    frequency: { type: Type.STRING },
                    code: { type: Type.STRING },
                    evidenceQuote: { type: Type.STRING },
                  },
                  required: [
                    'category',
                    'activity',
                    'hoursPerWeek',
                    'peakOnly',
                    'frequency',
                    'code',
                    'evidenceQuote',
                  ],
                },
              },
              rootCauses: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    failure: { type: Type.STRING },
                    cause: { type: Type.STRING },
                    contributingFactors: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    needsApproval: { type: Type.BOOLEAN },
                    evidenceQuote: { type: Type.STRING },
                  },
                  required: [
                    'failure',
                    'cause',
                    'contributingFactors',
                    'needsApproval',
                    'evidenceQuote',
                  ],
                },
              },
              kaizenActions: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    step: { type: Type.STRING },
                    target: { type: Type.STRING },
                    owner: { type: Type.STRING },
                    measure: { type: Type.STRING },
                    code: { type: Type.STRING },
                  },
                  required: ['step', 'target', 'owner', 'measure', 'code'],
                },
              },
              strengths: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
            required: [
              'processName',
              'processCode',
              'summary',
              'statedHours',
              'activities',
              'rootCauses',
              'kaizenActions',
              'strengths',
            ],
          },
        },
      });

      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(jsonText);
      } catch {
        res.status(502).json({
          error: 'The AI returned an invalid sheet structure. Please retry.',
          code: 'INVALID_AI_JSON',
          requestId,
        });
        return;
      }

      const costSheet = validateAndComputeCostSheet(parsedJson, validCodes);
      res.json({ costSheet, modelUsed });
    } catch (err) {
      if (err instanceof AiServiceUnavailableError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          requestId,
        });
        return;
      }
      if (err instanceof FirestoreRestError) {
        res.status(502).json({
          error: 'Could not read interview transcript.',
          code: 'FIRESTORE_READ_ERROR',
          requestId,
        });
        return;
      }
      res.status(500).json({
        error: 'An unexpected error occurred while building the Quality Cost Sheet.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  });

  // 4. POST /api/admin/report
  app.post('/api/admin/report', requireAuth, async (req: AuthedRequest, res: Response) => {
    const requestId = req.requestId || 'unknown';
    const user = req.user!;

    try {
      const { isAdmin } = await resolveAdminStatus(user);
      if (!isAdmin) {
        res.status(403).json({
          error: 'Administrator access required.',
          code: 'FORBIDDEN',
          requestId,
        });
        return;
      }

      const [audits, baselineDoc] = await Promise.all([
        runCollectionGroupQuery('costAudits', user.idToken),
        getFirestoreDoc('settings/qualityBaseline', user.idToken),
      ]);
      const baselineDocs = Array.isArray(baselineDoc?.documents)
        ? (baselineDoc!.documents as BaselineDoc[])
        : [];
      const codeTitles = extractBaselineCodeTitles(baselineDocs);
      const aggregates = computeLedgerAggregates(audits, codeTitles);
      const today = new Date().toISOString().slice(0, 10);

      const promptText = fillPromptTemplate(PROMPT_3_TEMPLATE, {
        statsJson: JSON.stringify(aggregates.stats),
        categoryJson: JSON.stringify(aggregates.categoryBreakdown),
        processJson: JSON.stringify(aggregates.processAreas),
        failureJson: JSON.stringify(aggregates.topFailures),
        rootCauseJson: JSON.stringify(aggregates.rootCauseEntries),
        kaizenJson: JSON.stringify(aggregates.kaizenForPriorityAreas),
        strengthsJson: JSON.stringify(aggregates.strengthEntries),
        today,
      });

      const { text: jsonText, modelUsed } = await generateContentWithFallback({
        contents: promptText,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              markdown: { type: Type.STRING },
            },
            required: ['markdown'],
          },
        },
      });

      let parsed: { markdown?: unknown };
      try {
        parsed = JSON.parse(jsonText) as { markdown?: unknown };
      } catch {
        res.status(502).json({
          error: 'The AI returned an invalid report structure. Please retry.',
          code: 'INVALID_AI_JSON',
          requestId,
        });
        return;
      }

      if (typeof parsed.markdown !== 'string' || !parsed.markdown.trim()) {
        res.status(502).json({
          error: 'The AI returned an empty report. Please retry.',
          code: 'EMPTY_REPORT',
          requestId,
        });
        return;
      }

      res.json({
        markdown: parsed.markdown.trim(),
        stats: aggregates.stats,
        modelUsed,
      });
    } catch (err) {
      if (err instanceof AiServiceUnavailableError) {
        res.status(err.status).json({
          error: err.message,
          code: err.code,
          requestId,
        });
        return;
      }
      if (err instanceof FirestoreRestError) {
        res.status(502).json({
          error: 'Could not read quality audits from Firestore.',
          code: 'FIRESTORE_READ_ERROR',
          requestId,
        });
        return;
      }
      res.status(500).json({
        error: 'An unexpected error occurred while generating the consolidated report.',
        code: 'INTERNAL_ERROR',
        requestId,
      });
    }
  });

  // Return structured JSON on unknown /api/* routes
  app.all('/api/{*splat}', (req: AuthedRequest, res: Response) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'NOT_FOUND',
      requestId: req.requestId || 'unknown',
    });
  });

  // Frontend serving: Vite in development, static dist/ in production
  if (process.env.NODE_ENV === 'production') {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  // Keep reference to buildWelcomeMessage to verify shared import integrity
  void buildWelcomeMessage;

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`NDKC Quality Cost Audit server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
