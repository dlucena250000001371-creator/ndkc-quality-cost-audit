import fs from 'fs';
import path from 'path';

export interface FirebaseAppletConfig {
  projectId: string;
  firestoreDatabaseId: string;
}

let cachedConfig: FirebaseAppletConfig | null = null;

export function getFirebaseConfig(): FirebaseAppletConfig {
  if (cachedConfig) return cachedConfig;
  const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
  const raw = fs.readFileSync(configPath, 'utf-8');
  const parsed = JSON.parse(raw) as Partial<FirebaseAppletConfig>;
  if (!parsed.projectId) {
    throw new Error('Missing projectId in firebase-applet-config.json');
  }
  cachedConfig = {
    projectId: parsed.projectId,
    firestoreDatabaseId: parsed.firestoreDatabaseId || '(default)',
  };
  return cachedConfig;
}
