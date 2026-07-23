import * as crypto from 'crypto';
import * as YAML from 'yaml';
import { buildPaths } from '../dependencyGraph';

export interface ParsedPackage {
  name: string;
  version: string;
  direct: boolean;
  dev: boolean;
  optional: boolean;
  peer: boolean;
  paths: string[][];
  pathCountAtLeast: number;
  licenseRaw?: string;
  installPaths: string[];
}

export interface ParsedLockfileResult {
  packages: ParsedPackage[];
  warnings: string[];
}

interface PnpmImporterDep {
  specifier: string;
  version: string;
}

interface PnpmSnapshotEntry {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  optional?: boolean;
}

interface PnpmLockFile {
  importers?: Record<string, {
    dependencies?: Record<string, PnpmImporterDep>;
    devDependencies?: Record<string, PnpmImporterDep>;
    optionalDependencies?: Record<string, PnpmImporterDep>;
  }>;
  snapshots?: Record<string, PnpmSnapshotEntry>;
}

// "left-pad@1.3.0" -> "left-pad" ; "@scope/pkg@1.0.0" -> "@scope/pkg"
// "react-redux@8.1.3(react@18.2.0)(redux@4.2.1)" -> "react-redux"/"8.1.3" — the
// peer-dependency suffix (everything from the first "(" onward) is stripped BEFORE
// looking for the name/version-separating "@", otherwise `lastIndexOf('@')` finds the
// "@" inside the LAST peer's own "name@version" instead of the real one (e.g. it would
// split "react-redux@8.1.3(react@18.2.0)(redux" / "4.2.1)" — silently wrong name AND
// version for every peer-suffixed package, not just a diskPath gap).
function splitNameVersion(key: string): { name: string; version: string } {
  const parenIndex = key.indexOf('(');
  const base = parenIndex === -1 ? key : key.slice(0, parenIndex);
  const lastAt = base.lastIndexOf('@');
  if (lastAt <= 0) return { name: base, version: 'unknown' };
  return { name: base.slice(0, lastAt), version: base.slice(lastAt + 1) };
}

// Real .pnpm store content-directory name for a full snapshot key, INCLUDING any
// parenthesized peer-dependency suffix(es) — e.g.
// "react-redux@8.1.3(@types/react@18.3.31)(react@18.2.0)(redux@4.2.1)" ->
// "react-redux@8.1.3_@types+react@18.3.31_react@18.2.0_redux@4.2.1".
//
// This is NOT a guess: reverse-engineered from pnpm 9.15.9's actual bundled source
// (`@pnpm/dependency-path`'s `depPathToFilename`/`depPathToFilenameUnescaped`, in
// pnpm.cjs) and independently CONFIRMED by running real `pnpm install` against real
// npm-registry packages (react-redux@8.1.3 with react/redux/@types-react peers) and
// diffing the resulting `node_modules/.pnpm/*` directory names against this
// implementation's output — exact match, including the length-based hash fallback
// below (verified against a real >120-char peer chain from a typescript-eslint +
// eslint-plugin-import install). Algorithm:
//   1. Filesystem-unsafe characters (\ / : * ? " < > |) are replaced with "+"
//      GLOBALLY, not just the first occurrence — a peer suffix can itself contain
//      multiple scoped package names (e.g. "@types/react" alongside the main
//      package's own scope), and the pre-existing single-occurrence `.replace('/',
//      '+')` silently missed every occurrence after the first.
//   2. If the result contains "(" (one or more peer suffixes present): strip a
//      trailing ")" if present, then collapse every remaining "(", ")", or adjacent
//      ")(" pair to a single "_". This turns
//      "pkg@1.0.0(peerA@1.0.0)(peerB@2.0.0)" into "pkg@1.0.0_peerA@1.0.0_peerB@2.0.0",
//      and nested peer-of-a-peer parens collapse the same way.
//   3. Real pnpm's `depPathToFilename` hashes (MD5+base32, see below) whenever
//      EITHER of two independent conditions holds — this was under-implemented
//      until a dedicated review of the peer-suffix commit above (0749bd4) caught
//      it: only condition (a) had been reproduced, and the code comment on this
//      function overclaimed "byte-for-byte" verification without disclosing the
//      gap. Both are now implemented and OR'd together, matching real pnpm:
//        (a) the encoded name exceeds pnpm's default `virtualStoreDirMaxLength`
//            (120 characters) — a real occurrence once several peer-suffixed
//            packages compound in one snapshot key, not a hypothetical.
//        (b) the encoded name is not identical to its own lowercased form AND
//            does not start with "file+" (pnpm's escaped form of the "file:"
//            protocol prefix used for local/path dependencies, produced by step 1
//            turning "file:" into "file+" — local/path deps are deliberately
//            exempted from the mixed-case trigger by real pnpm). Confirmed via a
//            real pnpm 9.15.9 divergence: a snapshot key with uppercase letters in
//            a prerelease version tag (e.g. "some-pkg@1.0.0-RC.1") hashes under
//            real pnpm even though it is nowhere near the 120-char length trigger.
//      When either condition is true, pnpm truncates the encoded name to 93
//      characters (120 - 27, a no-op slice when the name is already shorter) and
//      appends "_" + a lowercase, unpadded RFC4648 base32 encoding of the MD5 hash
//      of the FULL (untruncated, pre-truncation) encoded name. Reproduced here with
//      Node's `crypto` module (md5) plus a small hand-rolled base32 encoder, since
//      Node has no built-in base32 support; the encoding itself (not the trigger
//      conditions) was checked byte-for-byte against a real pnpm-generated hashed
//      directory name during the original verification pass.
const PNPM_STORE_DIR_MAX_LENGTH = 120;
const PNPM_STORE_DIR_HASH_TRUNCATE_LENGTH = PNPM_STORE_DIR_MAX_LENGTH - 27; // 93
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32EncodeLowerNoPadding(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output.toLowerCase();
}

function pnpmContentHash(str: string): string {
  return base32EncodeLowerNoPadding(crypto.createHash('md5').update(str).digest());
}

function pnpmStoreDirName(key: string): string {
  let filename = key.replace(/[\\/:*?"<>|]/g, '+');
  if (filename.includes('(')) {
    filename = filename.replace(/\)$/, '').replace(/\)\(|\(|\)/g, '_');
  }
  // Hash fallback fires on EITHER trigger, matching real pnpm's depPathToFilename —
  // see the extended comment on pnpmStoreDirName above for how each was verified.
  const isTooLong = filename.length > PNPM_STORE_DIR_MAX_LENGTH;
  const isMixedCaseNonFileProtocol = filename !== filename.toLowerCase() && !filename.startsWith('file+');
  if (isTooLong || isMixedCaseNonFileProtocol) {
    return `${filename.slice(0, PNPM_STORE_DIR_HASH_TRUNCATE_LENGTH)}_${pnpmContentHash(filename)}`;
  }
  return filename;
}

function resolveEdge(depName: string, depVersion: string, snapshots: Map<string, PnpmSnapshotEntry>): string | undefined {
  const candidate = `${depName}@${depVersion}`;
  return snapshots.has(candidate) ? candidate : undefined;
}

export function parsePnpmLock(contents: string, opts: { productionOnly: boolean }): ParsedLockfileResult {
  const doc = YAML.parse(contents) as PnpmLockFile;
  const snapshots = new Map(Object.entries(doc.snapshots ?? {}));
  const rootImporter = (doc.importers ?? {})['.'] ?? {};

  const prodDeps: Record<string, string> = {};
  for (const [name, dep] of Object.entries(rootImporter.dependencies ?? {})) prodDeps[name] = dep.version;
  // optionalDependencies are normal runtime deps that may simply be skipped at
  // install time — they belong in the "prod" bucket, not the "dev" one.
  for (const [name, dep] of Object.entries(rootImporter.optionalDependencies ?? {})) prodDeps[name] = dep.version;

  const devDeps: Record<string, string> = {};
  for (const [name, dep] of Object.entries(rootImporter.devDependencies ?? {})) devDeps[name] = dep.version;

  const getNode = (key: string) => {
    const entry = snapshots.get(key);
    if (!entry) return undefined;
    // Merge optionalDependencies alongside dependencies — a package reachable
    // only via another package's optionalDependencies edge (e.g. fsevents
    // under a build-tool dependency) must still be visited, exactly like the
    // package-lock parser's equivalent fix (see Task 2's supersession note).
    const dependencies = { ...(entry.dependencies ?? {}), ...(entry.optionalDependencies ?? {}) };
    return { key, dependencies };
  };
  const edgeResolver = (_fromKey: string, depName: string, depVersion: string) => resolveEdge(depName, depVersion, snapshots);
  const nameForKey = (key: string) => splitNameVersion(key).name;

  const prodOnlyPaths = buildPaths<string>({ rootKey: '', rootDependencies: prodDeps, getNode, resolveEdge: edgeResolver, nameForKey });
  const allPaths = buildPaths<string>({ rootKey: '', rootDependencies: { ...prodDeps, ...devDeps }, getNode, resolveEdge: edgeResolver, nameForKey });

  const directKeys = new Set<string>();
  for (const [name, version] of Object.entries({ ...prodDeps, ...devDeps })) {
    const resolved = resolveEdge(name, version, snapshots);
    if (resolved) directKeys.add(resolved);
  }

  const packages: ParsedPackage[] = [];
  for (const [key, entry] of snapshots) {
    const pathInfo = allPaths.get(key);
    if (!pathInfo) continue;
    const isDev = !prodOnlyPaths.has(key);
    if (opts.productionOnly && isDev) continue;

    packages.push({
      name: splitNameVersion(key).name,
      version: splitNameVersion(key).version,
      direct: directKeys.has(key),
      dev: isDev,
      optional: !!entry.optional,
      peer: false,
      paths: pathInfo.examples,
      pathCountAtLeast: pathInfo.pathCountAtLeast,
      licenseRaw: undefined, // pnpm-lock.yaml does not carry license metadata; left for a later milestone's registry-metadata step
      installPaths: [
        `node_modules/${splitNameVersion(key).name}`,
        `node_modules/.pnpm/${pnpmStoreDirName(key)}/node_modules/${splitNameVersion(key).name}`,
      ],
    });
  }

  return { packages, warnings: [] };
}
