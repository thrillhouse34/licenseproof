import { parseSpdxExpression } from './spdxParser';

export interface ProjectLicenseContext {
  displayId: string;
  modeId: string;
  wasUnspecified: boolean;
}

const UNSPECIFIED: ProjectLicenseContext = { displayId: 'unspecified', modeId: 'proprietary', wasUnspecified: true };

export function resolveProjectLicenseContext(manifestLicenseRaw: string | undefined, cliOverride: string | undefined): ProjectLicenseContext {
  const raw = cliOverride ?? manifestLicenseRaw;
  if (!raw || !raw.trim()) return UNSPECIFIED;

  const parsed = parseSpdxExpression(raw);
  if (!parsed.ok) return UNSPECIFIED;

  return { displayId: raw, modeId: raw, wasUnspecified: false };
}
