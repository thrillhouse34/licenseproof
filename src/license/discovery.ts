import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * The on-disk location an activated key is stored at:
 * `~/.config/licenseproof/license.key`. Shared by discovery, `activate`, and
 * `deactivate` so all three agree on one path.
 */
export function licenseKeyPath(): string {
  return path.join(os.homedir(), '.config', 'licenseproof', 'license.key');
}

export interface DiscoverOptions {
  /** The `--key` value passed on the command line, if any (highest priority). */
  cliKey?: string;
  /** Environment to read `LICENSEPROOF_KEY` from. Defaults to `process.env`. */
  env?: NodeJS.ProcessEnv;
  /** Key-file path. Defaults to `licenseKeyPath()`. Injectable for hermetic tests. */
  keyFilePath?: string;
}

/**
 * Resolve a license key string from the standard discovery order, or `undefined`
 * if none is present:
 *
 *   1. explicit `--key <string>` (the `cliKey` argument)
 *   2. `LICENSEPROOF_KEY` environment variable
 *   3. `~/.config/licenseproof/license.key` file content
 *
 * A higher-priority source is used only when present and non-empty; the env var
 * and file are consulted lazily (the file is only read when both the CLI key and
 * env var are absent). Every source is trimmed — a stored/pasted key may carry a
 * trailing newline. This function only LOCATES a key; it does not verify it —
 * `verifyLicenseKey` is the sole authority on validity.
 */
export function discoverLicenseKey(opts: DiscoverOptions = {}): string | undefined {
  const cli = opts.cliKey?.trim();
  if (cli) return cli;

  const env = opts.env ?? process.env;
  const fromEnv = env.LICENSEPROOF_KEY?.trim();
  if (fromEnv) return fromEnv;

  const filePath = opts.keyFilePath ?? licenseKeyPath();
  try {
    const fromFile = fs.readFileSync(filePath, 'utf8').trim();
    if (fromFile) return fromFile;
  } catch {
    // Absent or unreadable file → no key from this source.
  }

  return undefined;
}
