# Developing licenseproof

**Build & test:** `npm install`, then `npm run build` to compile TypeScript to `dist/`, or `npm test` to run the vitest suite directly against `src/` (no build needed for tests). `npm run dev -- scan <path>` runs the CLI without building, via `tsx`.

**Project shape:** `src/ecosystems/npm/*Parser.ts` are pure functions — `(fileContents, options) → { packages, warnings }` — with no filesystem access, which is what makes them trivial to test against fixtures. `src/ecosystems/npm.ts` is the only module that touches disk: it picks a lockfile by priority (package-lock.json > pnpm-lock.yaml > yarn.lock), calls the matching pure parser, then does the filesystem-dependent work parsers structurally can't (checking whether an optional/peer dependency is actually installed under `node_modules`, detecting monorepo workspaces, falling back when no lockfile exists).

**Adding a fixture:** create a new directory under `fixtures/`, add a `package.json` and the lockfile you're testing (plus a real `node_modules/<pkg>/package.json` if the test needs to verify on-disk presence, e.g. for optional-dependency filtering). Point a new `it(...)` block in the matching `tests/ecosystems/npm/*.test.ts` file at it by directory name — fixtures are read via `fs.readFileSync`, no registration step needed.
