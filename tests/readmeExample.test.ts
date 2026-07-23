import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { runScan } from '../src/cli/scan';

/**
 * Anti-staleness guard for README.md's "## Real output example" section.
 *
 * That section shows a real, hand-captured terminal transcript of running
 * `licenseproof scan` against `fixtures/resolve-08-conflict-matrix`. It has
 * gone stale before (M4's final review flagged a `licenseproof 0.1.0 · data
 * 2026.07.21` version string that no longer matched reality) with nothing
 * catching it. This test runs the SAME command against the SAME fixture via
 * `runScan` (the exact function the real CLI binary calls) and asserts the
 * README's embedded code block matches byte-for-byte — except the
 * `scanned <ISO timestamp>` fragment, which legitimately changes on every
 * run and is masked out on both sides before comparing.
 *
 * If this test fails, the fix is almost always: re-run the documented
 * command, paste the real output back into the README's fenced code block.
 */

const README_PATH = path.join(__dirname, '..', 'README.md');
const FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'resolve-08-conflict-matrix');
const TIMESTAMP_RE = /scanned \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/;

interface ParsedExample {
  commandLine: string;
  output: string;
  exitCode: number;
}

function parseExampleBlock(readme: string): ParsedExample {
  const afterHeading = readme.split('## Real output example')[1];
  if (afterHeading === undefined) {
    throw new Error('README.md is missing the "## Real output example" section — did it get renamed?');
  }

  const fenceMatch = afterHeading.match(/```\n([\s\S]*?)```/);
  if (!fenceMatch) {
    throw new Error('Could not find a fenced code block under "## Real output example".');
  }

  const lines = fenceMatch[1].split('\n');
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();

  const commandLine = lines[0];
  if (!commandLine || !commandLine.startsWith('$ licenseproof scan ')) {
    throw new Error(`Expected the example block to open with "$ licenseproof scan <path>", got: ${JSON.stringify(commandLine)}`);
  }

  const echoIdx = lines.findIndex((l) => l.trim() === '$ echo $?');
  if (echoIdx === -1) {
    throw new Error('Could not find the "$ echo $?" line that reports the documented exit code.');
  }
  const exitCodeLine = lines[echoIdx + 1];
  const exitCode = Number(exitCodeLine?.trim());
  if (Number.isNaN(exitCode)) {
    throw new Error(`Could not parse an exit code after "$ echo $?", got: ${JSON.stringify(exitCodeLine)}`);
  }

  const outputLines = lines.slice(1, echoIdx);
  while (outputLines.length > 0 && outputLines[outputLines.length - 1] === '') outputLines.pop();

  return { commandLine, output: outputLines.join('\n'), exitCode };
}

describe('README "Real output example" stays in sync with a live scan', () => {
  it('matches a live run of the documented command against its own fixture (timestamp masked)', async () => {
    const readme = fs.readFileSync(README_PATH, 'utf8');
    const parsed = parseExampleBlock(readme);

    // The command line itself must name a path this test actually scans, so a
    // future fixture rename can't silently desync the documented path from
    // what's really being asserted against.
    expect(parsed.commandLine).toBe('$ licenseproof scan fixtures/resolve-08-conflict-matrix');
    expect(fs.existsSync(FIXTURE_PATH)).toBe(true);

    const result = await runScan({
      path: FIXTURE_PATH,
      productionOnly: true,
      format: 'summary',
      failOn: 'conflict',
      projectLicenseOverride: undefined,
      colorEnabled: false,
    });

    expect(result.exitCode).toBe(parsed.exitCode);
    expect(parsed.output.replace(TIMESTAMP_RE, 'scanned <TIMESTAMP>')).toBe(
      result.output.replace(TIMESTAMP_RE, 'scanned <TIMESTAMP>'),
    );
  });
});
