import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../paths';

interface ClassifierMapFile {
  schemaVersion: number;
  note: string;
  classifiers: Record<string, string>;
}

let cached: ClassifierMapFile | undefined;
function load(): ClassifierMapFile {
  if (!cached) cached = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'classifier-to-spdx.json'), 'utf8'));
  return cached!;
}

/**
 * Maps a single PyPI Trove "License :: ..." classifier string to its SPDX
 * license id, per the vendored data/classifier-to-spdx.json table. Returns
 * undefined for a classifier with no entry (either it isn't a
 * license classifier at all, or it's one of the intentionally-unmapped
 * cases documented in that file's "note" field, e.g. "License ::
 * Other/Proprietary License" or the bare "License :: OSI Approved") — the
 * caller (the PyPI resolution pipeline, Milestone 4 Task 6) treats an
 * undefined result as "this step found nothing" and falls through to the
 * next resolution signal, exactly like every other resolution step's miss
 * case.
 */
export function mapClassifierToSpdxId(classifier: string): string | undefined {
  return load().classifiers[classifier];
}
