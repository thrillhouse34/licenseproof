import * as fs from 'fs';
import * as path from 'path';
import { verifyLicenseKey } from '../license/verify';
import { base64urlDecode, PRODUCT } from '../license/keyFormat';
import { licenseKeyPath } from '../license/discovery';

export interface RunActivateOptions {
  /** Key-file path override for hermetic tests. Defaults to `licenseKeyPath()`. */
  keyFilePath?: string;
}

export interface RunActivateResult {
  exitCode: number;
  output: string;
}

/**
 * Best-effort, cheap classification of WHY a key failed to verify, purely to
 * make the error message more helpful. This never trusts the payload — the key
 * has already failed cryptographic verification — it only peeks at the
 * (unverified) format to distinguish the three failure kinds the plan asks for:
 * malformed format vs. a well-formed key for a different product vs. a bad or
 * corrupted signature.
 */
function explainFailure(key: string): string {
  const lastDot = key.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === key.length - 1) {
    return 'that does not look like a license key (expected a single line with one "." separator).';
  }
  try {
    const parsed: unknown = JSON.parse(base64urlDecode(key.slice(0, lastDot)).toString('utf8'));
    if (parsed && typeof parsed === 'object' && (parsed as { product?: unknown }).product !== PRODUCT) {
      return 'this key is for a different product, not LicenseProof.';
    }
  } catch {
    // Fall through to the generic signature message.
  }
  return 'the license key could not be verified. It may be corrupted, incomplete, or not a genuine LicenseProof key.';
}

/**
 * `licenseproof activate <key>` — verify a license key and, on success, store it
 * at `~/.config/licenseproof/license.key` so the `report` command's gated
 * formats unlock on every later run.
 *
 * On failure: a clear error naming why (invalid format / wrong product / bad
 * signature), NOTHING is written, exit code 2 (a usage/input error, matching the
 * existing bad-CLI-input convention). On success: the raw key is written
 * (creating `~/.config/licenseproof/` if needed), a confirmation names the tier
 * and that reports are unlocked, exit code 0.
 */
export function runActivate(keyString: string, opts: RunActivateOptions = {}): RunActivateResult {
  const key = (keyString ?? '').trim();
  if (key === '') {
    return {
      exitCode: 2,
      output: 'licenseproof activate: no key provided.\nUsage: licenseproof activate <key>',
    };
  }

  const info = verifyLicenseKey(key);
  if (!info) {
    return {
      exitCode: 2,
      output: `licenseproof activate: ${explainFailure(key)} Nothing was written.`,
    };
  }

  const target = opts.keyFilePath ?? licenseKeyPath();
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    // Store the exact key the customer holds (mode 0600 — it's theirs alone).
    fs.writeFileSync(target, key, { mode: 0o600 });
  } catch (err) {
    return {
      exitCode: 2,
      output: `licenseproof activate: could not write the license file at ${target}: ${(err as Error).message}`,
    };
  }

  return {
    exitCode: 0,
    output:
      `licenseproof: activated your ${info.tier} license. The report command is now ` +
      `unlocked — audit-ready HTML and PDF reports, third-party notices, and SBOM output.`,
  };
}
