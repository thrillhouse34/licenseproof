import { describe, it, expect, afterEach } from 'vitest';
import * as path from 'path';
import { runScan } from '../../src/cli/scan';

const FIXTURES = path.join(__dirname, '..', '..', 'fixtures');
const CONFLICT_FIXTURE = path.join(FIXTURES, 'resolve-04-deprecated-id'); // CONFLICT under 'proprietary'
const CLEAN_FIXTURE = path.join(FIXTURES, 'package-lock-v3-basic'); // no CONFLICT

const NAG = 'Generate a lawyer-ready report of these findings: licenseproof.dev';

describe('scan — free-tier funnel nag line', () => {
  const ORIGINAL_ISTTY = process.stdout.isTTY;
  const ORIGINAL_NO_COLOR = process.env.NO_COLOR;

  afterEach(() => {
    (process.stdout as any).isTTY = ORIGINAL_ISTTY;
    if (ORIGINAL_NO_COLOR === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = ORIGINAL_NO_COLOR;
  });

  it('TTY + CONFLICT + summary → the nag line appears (once, as the final line)', async () => {
    (process.stdout as any).isTTY = true;
    const result = await runScan({
      path: CONFLICT_FIXTURE, productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: 'proprietary', colorEnabled: false,
    });
    expect(result.output).toContain(NAG);
    // Appears exactly once, and is the last line.
    expect(result.output.split(NAG).length - 1).toBe(1);
    expect(result.output.trimEnd().endsWith(NAG)).toBe(true);
  });

  it('TTY + CONFLICT + JSON → nag line does NOT appear (never in machine output)', async () => {
    (process.stdout as any).isTTY = true;
    const result = await runScan({
      path: CONFLICT_FIXTURE, productionOnly: true, format: 'json',
      failOn: 'never', projectLicenseOverride: 'proprietary',
    });
    expect(result.output).not.toContain(NAG);
    // And the JSON is still valid (nag never contaminated it).
    expect(() => JSON.parse(result.output)).not.toThrow();
  });

  it('non-TTY + CONFLICT + summary → nag line does NOT appear (piped/redirected output)', async () => {
    (process.stdout as any).isTTY = false;
    const result = await runScan({
      path: CONFLICT_FIXTURE, productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: 'proprietary', colorEnabled: false,
    });
    expect(result.output).not.toContain(NAG);
  });

  it('TTY + NO CONFLICT + summary → nag line does NOT appear', async () => {
    (process.stdout as any).isTTY = true;
    const result = await runScan({
      path: CLEAN_FIXTURE, productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: undefined, colorEnabled: false,
    });
    expect(result.output).not.toContain(NAG);
  });

  it('TTY + CONFLICT + summary + --no-color (colorEnabled:false) → nag line STILL appears (independent of color)', async () => {
    (process.stdout as any).isTTY = true;
    const result = await runScan({
      path: CONFLICT_FIXTURE, productionOnly: true, format: 'summary',
      failOn: 'never', projectLicenseOverride: 'proprietary', colorEnabled: false,
    });
    // No ANSI in the output (color truly off) ...
    // eslint-disable-next-line no-control-regex
    expect(result.output).not.toMatch(/\x1b\[/);
    // ... yet the nag line is present anyway.
    expect(result.output).toContain(NAG);
  });
});
