import { describe, it, expect } from 'vitest';
import { buildPaths } from '../../../src/ecosystems/dependencyGraph';

interface Node {
  key: string;
  dependencies: Record<string, string>;
}

function makeGraph(nodes: Record<string, Node>, rootDeps: Record<string, string>) {
  return buildPaths<string>({
    rootKey: '',
    rootDependencies: rootDeps,
    getNode: (key) => nodes[key],
    resolveEdge: (_fromKey, depName) => (nodes[depName] ? depName : undefined),
    nameForKey: (key) => key,
  });
}

describe('buildPaths', () => {
  it('records a simple chain from root', () => {
    const nodes: Record<string, Node> = {
      express: { key: 'express', dependencies: { 'body-parser': '^1.0.0' } },
      'body-parser': { key: 'body-parser', dependencies: {} },
    };
    const info = makeGraph(nodes, { express: '^4.0.0' });
    expect(info.get('express')!.examples).toEqual([['express']]);
    expect(info.get('express')!.pathCountAtLeast).toBe(1);
    expect(info.get('body-parser')!.examples).toEqual([['express', 'body-parser']]);
    expect(info.get('body-parser')!.pathCountAtLeast).toBe(1);
  });

  it('records multiple distinct paths and an exact count for a diamond dependency', () => {
    const nodes: Record<string, Node> = {
      a: { key: 'a', dependencies: { shared: '^1.0.0' } },
      b: { key: 'b', dependencies: { shared: '^1.0.0' } },
      shared: { key: 'shared', dependencies: {} },
    };
    const info = makeGraph(nodes, { a: '^1.0.0', b: '^1.0.0' });
    expect(info.get('shared')!.examples).toEqual([['a', 'shared'], ['b', 'shared']]);
    expect(info.get('shared')!.pathCountAtLeast).toBe(2);
  });

  it('caps examples at 3 and counts every parent even beyond the cap', () => {
    const nodes: Record<string, Node> = { shared: { key: 'shared', dependencies: {} } };
    const rootDeps: Record<string, string> = {};
    for (const name of ['p1', 'p2', 'p3', 'p4', 'p5']) {
      nodes[name] = { key: name, dependencies: { shared: '^1.0.0' } };
      rootDeps[name] = '^1.0.0';
    }
    const info = makeGraph(nodes, rootDeps);
    expect(info.get('shared')!.examples).toHaveLength(3);
    expect(info.get('shared')!.pathCountAtLeast).toBe(5);
  });

  it('caps recursion on a circular dependency instead of looping forever, counting the closing path once', () => {
    const nodes: Record<string, Node> = {
      'pkg-a': { key: 'pkg-a', dependencies: { 'pkg-b': '^1.0.0' } },
      'pkg-b': { key: 'pkg-b', dependencies: { 'pkg-a': '^1.0.0' } },
    };
    const start = Date.now();
    const info = makeGraph(nodes, { 'pkg-a': '^1.0.0' });
    expect(Date.now() - start).toBeLessThan(1000);
    expect(info.get('pkg-a')!.examples).toEqual([['pkg-a'], ['pkg-a', 'pkg-b', 'pkg-a']]);
    expect(info.get('pkg-a')!.pathCountAtLeast).toBe(2);
    expect(info.get('pkg-b')!.examples).toEqual([['pkg-a', 'pkg-b']]);
    expect(info.get('pkg-b')!.pathCountAtLeast).toBe(1);
  });

  it('returns an empty map when there are no root dependencies', () => {
    const info = makeGraph({}, {});
    expect(info.size).toBe(0);
  });

  it('skips a dependency that resolveEdge cannot resolve', () => {
    const nodes: Record<string, Node> = { real: { key: 'real', dependencies: {} } };
    const info = makeGraph(nodes, { real: '^1.0.0', missing: '^1.0.0' });
    expect(info.get('real')!.examples).toEqual([['real']]);
    expect(info.has('missing')).toBe(false);
  });

  it('parses a 12-layer, 3-fanout diamond graph (small node count, exponential path count) in under 2 seconds', () => {
    const LAYERS = 12;
    const WIDTH = 3;
    const nodes: Record<string, Node> = {};
    for (let layer = 0; layer < LAYERS; layer++) {
      for (let i = 0; i < WIDTH; i++) {
        const name = `l${layer}-${i}`;
        const dependencies: Record<string, string> = {};
        if (layer < LAYERS - 1) {
          for (let j = 0; j < WIDTH; j++) dependencies[`l${layer + 1}-${j}`] = '^1.0.0';
        }
        nodes[name] = { key: name, dependencies };
      }
    }
    const rootDeps: Record<string, string> = {};
    for (let i = 0; i < WIDTH; i++) rootDeps[`l0-${i}`] = '^1.0.0';

    const start = Date.now();
    const info = makeGraph(nodes, rootDeps);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(2000);
    expect(info.size).toBe(LAYERS * WIDTH);
    const lastLayerNode = info.get(`l${LAYERS - 1}-0`)!;
    expect(lastLayerNode.examples).toHaveLength(3);
    // True path count to the deepest layer is 3^11 (~177,147) — far past the 1000 cap.
    expect(lastLayerNode.pathCountAtLeast).toBe(1000);
  });
});
