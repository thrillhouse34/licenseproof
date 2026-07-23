import * as fs from 'fs';
import * as path from 'path';
import { REPO_ROOT } from './paths';

let cached: string | undefined;
export function getToolVersion(): string {
  if (!cached) {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'));
    cached = pkg.version;
  }
  return cached!;
}
