import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../paths';

interface SpdxLicenseListFile {
  schemaVersion: number;
  licenses: Array<{ licenseId: string; name: string; isDeprecatedLicenseId: boolean; isOsiApproved: boolean }>;
  deprecatedMap: Record<string, string>;
}

let cached: SpdxLicenseListFile | undefined;
function load(): SpdxLicenseListFile {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'spdx-licenses.json'), 'utf8'));
  return cached!;
}

export function normalizeSpdxId(id: string): { normalized: string; wasDeprecated: boolean } {
  const replacement = load().deprecatedMap[id];
  return replacement ? { normalized: replacement, wasDeprecated: true } : { normalized: id, wasDeprecated: false };
}

export function isKnownSpdxId(id: string): boolean {
  return load().licenses.some((l) => l.licenseId === id);
}
