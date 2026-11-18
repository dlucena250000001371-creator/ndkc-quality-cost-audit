# NDKC Quality Cost Audit

A Total Quality Management (TQM) interview and Cost of Quality (PAF) ledger web application for **Notre Dame of Kidapawan College (NDKC)** in Kidapawan City, Cotabato.

Employees complete a 7-question structured interview with the AI **Audit Partner** about one core work process. The server invokes Gemini (with an automated model fallback ladder) to generate a **Quality Cost Sheet** across Prevention, Appraisal, Internal Failure, and External Failure, while the super administrator reviews institutional metrics, baseline documents, consolidated reports, and full transcripts in the **Quality Cost Ledger**.

---

## Architecture & Security Highlights

- **User Identity**: Google Sign-In via Firebase Authentication (no passwords or emails stored in Firestore).
- **Browser-Owned Writes / Server-Side Verification**: Only the browser writes to Firestore under user-isolated paths (`/users/{uid}/...`). The Express server verifies Firebase ID tokens via `firebase-admin` (initialized with `projectId` only) and reads Firestore strictly through the Firestore REST API (`documents.get` and `runQuery`) using the caller's own ID token.
- **Super Administrator Gate**: Admin privileges require both `ADMIN_EMAIL` (server-side environment variable) and a manually provisioned `/admins/{uid}` document (`{ role: "superadmin" }`) in Firestore.
- **Gemini Fallback Resilience**: Uses `@google/genai` server-side with `gemini-3.6-flash` → `gemini-3.1-flash-lite` → `gemini-flash-latest` → `gemini-3.7-flash` → `gemini-4-hydrogen`, 45-second per-attempt timeouts, 10-minute cooldown on 429 quota responses, and up to 3 retry rounds.

---

## 1. Prerequisites & Google Cloud APIs

1. Install the [Google Cloud CLI (`gcloud`)](https://cloud.google.com/sdk/docs/install) and [Firebase CLI](https://firebase.google.com/docs/cli).
2. Enable required Google Cloud services on your project:

```bash
gcloud services enable \
  run.googleapis.com \
  secretmanager.googleapis.com \
  firestore.googleapis.com \
  cloudbuild.googleapis.com
```

---

## 2. Secret Management Setup

Store `GEMINI_API_KEY` in Google Cloud Secret Manager and grant your Cloud Run runtime service account access:

```bash
# Create and populate the secret
gcloud secrets create GEMINI_API_KEY --replication-policy="automatic"
echo -n "YOUR_GEMINI_API_KEY" | gcloud secrets versions add GEMINI_API_KEY --data-file=-

# Grant the default Cloud Run service account access to read the secret
gcloud secrets add-iam-policy-binding GEMINI_API_KEY \
  --member="serviceAccount:YOUR_PROJECT_NUMBER-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

---

## 3. Firestore Database & Security Rules

Provision Cloud Firestore and deploy `firestore.rules` (using your named database ID from `firebase-applet-config.json`):

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }

    match /users/{userId} {
      allow get: if request.auth != null && request.auth.uid == userId;
      match /costAudits/{auditId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
      match /interactions/{interactionId} {
        allow read, write: if request.auth != null && request.auth.uid == userId;
      }
    }
  }
}
```

Deploy the full ruleset in `firestore.rules` to your Firestore database:

```bash
firebase deploy --only firestore:rules
```

### Super Administrator Bootstrap
1. Set `ADMIN_EMAIL` in your Cloud Run environment variables to your super administrator Google account email.
2. Sign in once with that Google account.
3. Copy the `uid` displayed on the in-app **Super Administrator Setup Required** card.
4. In the Firebase Console under Firestore (`ai-studio-94143578-6d9e-4c15-9792-97b372429cd0`), create document `/admins/<UID>` with field `role` = `"superadmin"` (string).

---

## 4. Local Development & Production Build

```bash
npm install
npm run dev      # Starts Express + Vite dev server on port 3000
npm run build    # Builds frontend into dist/
npm start        # Runs production server (NODE_ENV=production tsx server.ts)
```

---

## 5. Cloud Run Deployment & Campaign Verification

Build and deploy the unified full-stack application to Cloud Run:

```bash
gcloud run deploy ndkc-quality-cost-audit \
  --source . \
  --region asia-southeast1 \
  --allow-unauthenticated \
  --set-secrets GEMINI_API_KEY=GEMINI_API_KEY:latest \
  --set-env-vars NODE_ENV=production,ADMIN_EMAIL=<SUPER_ADMIN_EMAIL>,FORCE_MODEL_FAILURE=false
```

Apply the required challenge verification label to your Cloud Run service:

```bash
gcloud run services update ndkc-quality-cost-audit \
  --update-labels=dev-tutorial=cloud-run-ai-challenge \
  --region=asia-southeast1
```
