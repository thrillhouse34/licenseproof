import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { getToolVersion } from '../src/toolVersion';
import { REPO_ROOT } from '../src/paths';

describe('getToolVersion', () => {
  it('reads the real version from package.json', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    expect(getToolVersion()).toBe(pkg.version);
  });
});
