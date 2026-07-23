import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../paths';

export interface DataManifest {
  dataVersion: string;
  spdxListVersion: string;
  generatedAt: string;
}

let cached: DataManifest | undefined;
function load(): DataManifest {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'manifest.json'), 'utf8'));
  return cached!;
}

export function getDataManifest(): DataManifest {
  return load();
}

export function getDataVersion(): string {
  return load().dataVersion;
}
