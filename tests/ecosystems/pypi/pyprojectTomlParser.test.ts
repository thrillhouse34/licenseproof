import { describe, it, expect } from 'vitest';
import { parsePyprojectToml } from '../../../src/ecosystems/pypi/pyprojectTomlParser';

describe('parsePyprojectToml — PEP 621 [project]', () => {
  it('extracts names from [project.dependencies], stripping version constraints/extras/markers', () => {
    const src = `
[project]
name = "x"
dependencies = [
  "requests>=2.31.0",
  "click",
  "importlib-metadata; python_version < '3.8'",
  "flask[async]==3.0.0",
]
`;
    const { mainDeps, groupDeps } = parsePyprojectToml(src);
    expect(mainDeps).toEqual(['requests', 'click', 'importlib-metadata', 'flask']);
    expect(groupDeps).toEqual({});
  });

  it('treats each [project.optional-dependencies] extra as its own group', () => {
    const src = `
[project]
name = "x"
dependencies = ["requests>=2.31.0"]

[project.optional-dependencies]
dev = ["pytest>=7", "ruff"]
docs = ["sphinx"]
`;
    const { mainDeps, groupDeps } = parsePyprojectToml(src);
    expect(mainDeps).toEqual(['requests']);
    expect(groupDeps).toEqual({ dev: ['pytest', 'ruff'], docs: ['sphinx'] });
  });

  it('returns empty when [project] exists but declares no dependencies', () => {
    const { mainDeps, groupDeps } = parsePyprojectToml('[project]\nname = "x"\n');
    expect(mainDeps).toEqual([]);
    expect(groupDeps).toEqual({});
  });
});

describe('parsePyprojectToml — legacy [tool.poetry]', () => {
  it('reads [tool.poetry.dependencies] table keys as main deps, dropping the python key', () => {
    const src = `
[tool.poetry]
name = "x"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31.0"
click = { version = "^8.1", optional = true }
`;
    const { mainDeps } = parsePyprojectToml(src);
    expect(mainDeps.sort()).toEqual(['click', 'requests']);
    expect(mainDeps).not.toContain('python');
  });

  it('reads modern [tool.poetry.group.<name>.dependencies] groups', () => {
    const src = `
[tool.poetry]
name = "x"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31.0"

[tool.poetry.group.dev.dependencies]
pytest = "^7.0"

[tool.poetry.group.docs.dependencies]
sphinx = "^7.0"
`;
    const { mainDeps, groupDeps } = parsePyprojectToml(src);
    expect(mainDeps).toEqual(['requests']);
    expect(groupDeps).toEqual({ dev: ['pytest'], docs: ['sphinx'] });
  });

  it('reads the legacy flat [tool.poetry.dev-dependencies] as a dev group', () => {
    const src = `
[tool.poetry]
name = "x"

[tool.poetry.dependencies]
python = "^3.11"
requests = "^2.31.0"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
`;
    const { mainDeps, groupDeps } = parsePyprojectToml(src);
    expect(mainDeps).toEqual(['requests']);
    expect(groupDeps.dev).toEqual(['pytest']);
  });

  it('prefers PEP 621 [project] over [tool.poetry] when both are present', () => {
    const src = `
[project]
name = "x"
dependencies = ["requests>=2.31.0"]

[tool.poetry]
name = "x"

[tool.poetry.dependencies]
python = "^3.11"
should-be-ignored = "^1.0"
`;
    const { mainDeps } = parsePyprojectToml(src);
    expect(mainDeps).toEqual(['requests']);
    expect(mainDeps).not.toContain('should-be-ignored');
  });
});

describe('parsePyprojectToml — robustness', () => {
  it('returns empty rather than throwing on malformed TOML', () => {
    const { mainDeps, groupDeps } = parsePyprojectToml('this is [not valid = toml');
    expect(mainDeps).toEqual([]);
    expect(groupDeps).toEqual({});
  });
});
