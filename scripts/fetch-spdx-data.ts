import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

const DATA_DIR = path.join(__dirname, '..', 'data');
const SPDX_LIST_URL = 'https://raw.githubusercontent.com/spdx/license-list-data/main/json/licenses.json';

function fetchText(url: string): Promise<string> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'licenseproof-build-script' } }, (res) => {
      if (res.statusCode !== 200) { reject(new Error(`GET ${url} failed: ${res.statusCode}`)); return; }
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve(body));
    }).on('error', reject);
  });
}

// Deprecated-id -> current-id map for the IDs this project actually needs
// to normalize (spec §6 fixture 4: "GPL-3.0" vs "GPL-3.0-only").
const KNOWN_DEPRECATED_REPLACEMENTS: Record<string, string> = {
  'GPL-1.0': 'GPL-1.0-only', 'GPL-2.0': 'GPL-2.0-only', 'GPL-3.0': 'GPL-3.0-only',
  'LGPL-2.0': 'LGPL-2.0-only', 'LGPL-2.1': 'LGPL-2.1-only', 'LGPL-3.0': 'LGPL-3.0-only',
  'AGPL-1.0': 'AGPL-1.0-only', 'AGPL-3.0': 'AGPL-3.0-only',
  'GPL-2.0+': 'GPL-2.0-or-later', 'GPL-3.0+': 'GPL-3.0-or-later',
  'LGPL-2.1+': 'LGPL-2.1-or-later', 'LGPL-3.0+': 'LGPL-3.0-or-later',
};

const LICENSE_TEXTS_TO_VENDOR = [
  'MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0',
  'GPL-2.0-only', 'GPL-3.0-only', 'LGPL-2.1-only', 'LGPL-3.0-only', 'AGPL-3.0-only',
  'MPL-2.0', 'Unlicense', '0BSD', 'CC0-1.0',
];

async function main() {
  const raw = await fetchText(SPDX_LIST_URL);
  const list = JSON.parse(raw);
  const licenses = (list.licenses as any[]).map((l) => ({
    licenseId: l.licenseId as string,
    name: l.name as string,
    isDeprecatedLicenseId: !!l.isDeprecatedLicenseId,
    isOsiApproved: !!l.isOsiApproved,
  }));
  fs.writeFileSync(
    path.join(DATA_DIR, 'spdx-licenses.json'),
    JSON.stringify({ schemaVersion: 1, licenseListVersion: list.licenseListVersion, licenses, deprecatedMap: KNOWN_DEPRECATED_REPLACEMENTS }, null, 2),
  );
  console.log(`Wrote ${licenses.length} SPDX licenses (list version ${list.licenseListVersion}).`);

  const textsDir = path.join(DATA_DIR, 'license-texts');
  fs.mkdirSync(textsDir, { recursive: true });
  for (const id of LICENSE_TEXTS_TO_VENDOR) {
    const url = `https://raw.githubusercontent.com/spdx/license-list-data/main/text/${id}.txt`;
    try {
      const text = await fetchText(url);
      fs.writeFileSync(path.join(textsDir, `${id}.txt`), text);
      console.log(`Vendored ${id}.txt`);
    } catch (err) {
      console.error(`Failed to fetch ${id}.txt: ${(err as Error).message}`);
    }
  }
}

main().catch((err) => {
  console.error('fetch-spdx-data failed:', err.message);
  console.error('If offline, data/spdx-licenses.json and data/license-texts/*.txt already');
  console.error('committed from a prior run remain valid — only re-run this to pick up new');
  console.error('SPDX list versions.');
  process.exit(1);
});
