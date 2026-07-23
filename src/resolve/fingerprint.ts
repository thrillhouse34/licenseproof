import * as fs from 'fs';
import * as path from 'path';
import { DATA_DIR } from '../paths';

function normalizeTokens(text: string): Set<string> {
  const cleaned = text
    .toLowerCase()
    .replace(/copyright\s*\(c\)?\s*\d{0,4}[^\n]*/gi, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return new Set(cleaned.split(' ').filter(Boolean));
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  let intersection = 0;
  for (const tok of a) if (b.has(tok)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

interface VendoredText { licenseId: string; tokens: Set<string> }
let cachedTexts: VendoredText[] | undefined;
function loadVendoredTexts(): VendoredText[] {
  if (!cachedTexts) {
    const dir = path.join(DATA_DIR, 'license-texts');
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.txt')) : [];
    cachedTexts = files.map((f) => ({
      licenseId: f.replace(/\.txt$/, ''),
      tokens: normalizeTokens(fs.readFileSync(path.join(dir, f), 'utf8')),
    }));
  }
  return cachedTexts;
}

const MIN_SIMILARITY = 0.75;

export function fingerprintLicenseText(text: string): { licenseId: string; similarity: number } | null {
  const candidateTokens = normalizeTokens(text);
  let best: { licenseId: string; similarity: number } | null = null;
  for (const v of loadVendoredTexts()) {
    const similarity = jaccardSimilarity(candidateTokens, v.tokens);
    if (!best || similarity > best.similarity) best = { licenseId: v.licenseId, similarity };
  }
  return best && best.similarity >= MIN_SIMILARITY ? best : null;
}
