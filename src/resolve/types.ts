import type { ScannedPackage } from '../ecosystems/types';
import type { ConflictResult } from '../rules/conflicts';

export type { ConflictResult };

export type LicenseCategory = 'permissive' | 'weak-copyleft' | 'strong-copyleft' | 'noncommercial' | 'public-domain' | 'unknown';
export type ConfidenceLevel = 'high' | 'medium' | 'low';
export type ResolutionSource = 'metadata' | 'expression' | 'classifier' | 'license-file' | 'readme' | 'none';

export interface ResolvedPackage extends ScannedPackage {
  license: string;
  licenseIds: string[];
  category: LicenseCategory;
  confidence: ConfidenceLevel;
  source: ResolutionSource;
  normalizedFrom?: string;
  conflict: ConflictResult;
}
