// Simulated-filesystem tests for the browser-detection logic.
//
// These live in their own file because they need `fs.existsSync` under full
// control, and `vi.spyOn(fs, 'existsSync')` throws "Cannot redefine property"
// (Node's fs exports are non-configurable), so `fs` has to be mocked wholesale
// via a hoisted `vi.mock`. Isolating that here keeps the mock from affecting the
// real-filesystem work in pdf.test.ts (fixture reads, real Chrome renders).
//
// Mocking `fs` is safe for this module: src/report/pdf.ts touches the
// filesystem ONLY through `fs.existsSync` in `findChromeExecutable`, and the
// no-browser path throws before puppeteer is ever launched.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';
import { renderPdf, findChromeExecutable, NO_BROWSER_MESSAGE } from '../../src/report/pdf';
import type { ReportData } from '../../src/report/reportData';

vi.mock('fs', () => {
  const existsSync = vi.fn();
  return { existsSync, default: { existsSync } };
});

const existsSync = fs.existsSync as unknown as ReturnType<typeof vi.fn>;

const DATA: ReportData = {
  projectName: 'my-app',
  packages: [],
  warnings: [],
  projectLicense: { id: 'proprietary', wasUnspecified: false },
  toolVersion: '0.2.0',
  dataVersion: '2026.07.21',
  scanTimestamp: '2026-07-21T12:00:00.000Z',
  ecosystems: ['npm'],
};

beforeEach(() => {
  existsSync.mockReset();
});

describe('findChromeExecutable — path probing', () => {
  it('returns undefined when nothing is installed anywhere', () => {
    existsSync.mockReturnValue(false);
    expect(findChromeExecutable()).toBeUndefined();
    expect(existsSync).toHaveBeenCalled();
  });

  it('only probes paths that can exist on the current platform', () => {
    existsSync.mockReturnValue(false);
    findChromeExecutable();
    const probed = existsSync.mock.calls.map((c: unknown[]) => String(c[0]));

    expect(probed.length).toBeGreaterThan(0);
    if (process.platform === 'win32') {
      expect(probed.every((p: string) => p.endsWith('.exe'))).toBe(true);
      expect(probed.some((p: string) => p.startsWith('/'))).toBe(false);
    } else {
      // No pointless fs calls for Windows paths on a Unix-like OS.
      expect(probed.some((p: string) => p.includes('C:\\'))).toBe(false);
      expect(probed.every((p: string) => p.startsWith('/'))).toBe(true);
    }

    if (process.platform === 'darwin') {
      expect(probed).toContain('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
      expect(probed.some((p: string) => p.includes('Chromium.app'))).toBe(true);
      expect(probed.some((p: string) => p.includes('Microsoft Edge.app'))).toBe(true);
      // Linux locations are not probed on macOS.
      expect(probed.some((p: string) => p.startsWith('/usr/bin/'))).toBe(false);
    }
  });

  it('returns the FIRST matching candidate when several are installed', () => {
    existsSync.mockReturnValue(true);
    const found = findChromeExecutable();
    if (process.platform === 'darwin') {
      expect(found).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome');
    } else if (process.platform === 'win32') {
      expect(found).toBe('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe');
    } else {
      expect(found).toBe('/usr/bin/google-chrome');
    }
  });

  it('falls through to a later candidate when the first is absent', () => {
    // Only the SECOND candidate on each platform exists.
    let call = 0;
    existsSync.mockImplementation(() => ++call === 2);
    const found = findChromeExecutable();
    if (process.platform === 'darwin') {
      expect(found).toBe('/Applications/Chromium.app/Contents/MacOS/Chromium');
    } else if (process.platform === 'win32') {
      expect(found).toBe('C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe');
    } else {
      expect(found).toBe('/usr/bin/google-chrome-stable');
    }
  });
});

describe('renderPdf — no browser installed', () => {
  it('throws the exact honest fallback message, before launching anything', async () => {
    existsSync.mockReturnValue(false);
    await expect(renderPdf('<html><body>hi</body></html>', DATA)).rejects.toThrow(NO_BROWSER_MESSAGE);
  });

  it('throws a plain Error so runReport turns it into an exit-2 tool error', async () => {
    existsSync.mockReturnValue(false);
    await expect(renderPdf('<html></html>', DATA)).rejects.toBeInstanceOf(Error);
  });
});
