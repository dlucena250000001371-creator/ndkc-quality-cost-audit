import { getFirebaseConfig } from './config.ts';

interface FirestoreRestValue {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  nullValue?: null;
  timestampValue?: string;
  arrayValue?: { values?: FirestoreRestValue[] };
  mapValue?: { fields?: Record<string, FirestoreRestValue> };
}

interface FirestoreRestDocument {
  name?: string;
  fields?: Record<string, FirestoreRestValue>;
  createTime?: string;
  updateTime?: string;
}

function decodeValue(val: FirestoreRestValue | undefined): unknown {
  if (!val || typeof val !== 'object') return null;
  if ('stringValue' in val) return val.stringValue ?? '';
  if ('integerValue' in val) return Number(val.integerValue);
  if ('doubleValue' in val) return Number(val.doubleValue);
  if ('booleanValue' in val) return Boolean(val.booleanValue);
  if ('nullValue' in val) return null;
  if ('timestampValue' in val) return val.timestampValue ?? null;
  if ('arrayValue' in val) {
    const items = val.arrayValue?.values ?? [];
    return items.map((item) => decodeValue(item));
  }
  if ('mapValue' in val) {
    const fields = val.mapValue?.fields ?? {};
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return null;
}

function decodeDocument(doc: FirestoreRestDocument): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const fields = doc.fields ?? {};
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeValue(v);
  }
  if (doc.name) {
    const segments = doc.name.split('/');
    out.id = segments[segments.length - 1] || '';
    out.__path = doc.name;
  }
  return out;
}

function getBaseDocumentsUrl(): string {
  const { projectId, firestoreDatabaseId } = getFirebaseConfig();
  return `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/${encodeURIComponent(firestoreDatabaseId)}/documents`;
}

export class FirestoreRestError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function getFirestoreDoc(
  docPath: string,
  idToken: string
): Promise<Record<string, unknown> | null> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const url = `${getBaseDocumentsUrl()}/${cleanPath}`;
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${idToken}`,
    },
  });

  if (res.status === 404) {
    return null;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new FirestoreRestError(res.status, `Firestore documents.get failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const json = (await res.json()) as FirestoreRestDocument;
  return decodeDocument(json);
}

export async function runUserSubcollectionQuery(
  uid: string,
  collectionId: string,
  whereField: string,
  whereValue: string,
  idToken: string
): Promise<Array<Record<string, unknown>>> {
  const url = `${getBaseDocumentsUrl()}/users/${encodeURIComponent(uid)}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId }],
      where: {
        fieldFilter: {
          field: { fieldPath: whereField },
          op: 'EQUAL',
          value: { stringValue: whereValue },
        },
      },
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new FirestoreRestError(res.status, `Firestore runQuery failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreRestDocument }>;
  return rows.filter((r) => Boolean(r.document)).map((r) => decodeDocument(r.document!));
}

export async function runCollectionGroupQuery(
  collectionId: string,
  idToken: string
): Promise<Array<Record<string, unknown>>> {
  const url = `${getBaseDocumentsUrl()}:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId, allDescendants: true }],
    },
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${idToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new FirestoreRestError(res.status, `Firestore collection-group runQuery failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const rows = (await res.json()) as Array<{ document?: FirestoreRestDocument }>;
  return rows.filter((r) => Boolean(r.document)).map((r) => decodeDocument(r.document!));
}
