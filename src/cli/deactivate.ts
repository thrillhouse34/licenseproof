import * as fs from 'fs';
import { licenseKeyPath } from '../license/discovery';

export interface RunDeactivateOptions {
  /** Key-file path override for hermetic tests. Defaults to `licenseKeyPath()`. */
  keyFilePath?: string;
}

export interface RunDeactivateResult {
  exitCode: number;
  output: string;
}

/**
 * `licenseproof deactivate` — remove the stored license key at
 * `~/.config/licenseproof/license.key`. Idempotent: no error if the file is
 * already absent. Prints a confirmation either way, exit code 0. This is the
 * expected pair to `activate` and is what makes the "deactivate → gated format
 * refused" step of the simulated customer journey testable.
 */
export function runDeactivate(opts: RunDeactivateOptions = {}): RunDeactivateResult {
  const target = opts.keyFilePath ?? licenseKeyPath();
  try {
    if (fs.existsSync(target)) {
      fs.rmSync(target);
      return {
        exitCode: 0,
        output:
          'licenseproof: deactivated. The stored license key was removed; the ' +
          'report command’s paid formats will need a key again.',
      };
    }
  } catch (err) {
    // Exceptional (e.g. a permissions problem on the user's own config file).
    // Still exit 0 — deactivate is a "make sure it's gone" operation — but say so.
    return {
      exitCode: 0,
      output: `licenseproof: could not remove ${target}: ${(err as Error).message}`,
    };
  }
  return {
    exitCode: 0,
    output: 'licenseproof: no active license key was found. Nothing to remove.',
  };
}
