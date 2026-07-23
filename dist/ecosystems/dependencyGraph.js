"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPaths = buildPaths;
const MAX_EXAMPLES = 3;
const COUNT_CAP = 1000;
/**
 * Computes, for every package reachable from root, up to 3 example
 * dependency chains and a count (exact for the common acyclic case).
 *
 * Two passes, each bounded by the number of edges — never by the number of
 * distinct paths, which can grow exponentially with dependency-diamond
 * depth even in a graph with only a few hundred edges:
 *
 * 1. A single DFS with a GLOBAL visited set (`discovered`) expands every
 *    node's own dependency list exactly once, classifying each edge as
 *    either a DAG edge (`dagParents`) or a back edge (`backEdges`) — an
 *    edge whose target is currently on the DFS recursion stack, i.e. a
 *    genuine cycle-closing edge.
 * 2. Kahn's-algorithm-style topological DP over the DAG edges computes
 *    each node's examples/count from its already-finalized parents — a
 *    sum of integers, not an enumeration of paths, so an exponential
 *    number of distinct paths costs the same handful of arithmetic
 *    operations per edge that a linear chain would. Back edges are then
 *    applied as a single relaxation step each (not a fixpoint loop): the
 *    cycle contributes the one chain that closes the loop, matching the
 *    original "cap at first revisit" semantics, without re-propagating
 *    the update further downstream (a deliberate, documented limitation
 *    for nested-cycle graphs — real npm dependency trees are DAGs; the
 *    cases this undercounts are hand-crafted logical cycles).
 */
function buildPaths(opts) {
    // ---- Pass 1: O(V+E) graph construction with back-edge classification ----
    const discovered = new Set();
    const onStack = new Set();
    const dagParents = new Map();
    const backEdges = [];
    function addEdge(parent, child) {
        if (onStack.has(child)) {
            backEdges.push([parent, child]);
            return;
        }
        const parents = dagParents.get(child);
        if (parents)
            parents.push(parent);
        else
            dagParents.set(child, [parent]);
    }
    function visit(key) {
        if (discovered.has(key))
            return;
        discovered.add(key);
        onStack.add(key);
        const node = opts.getNode(key);
        for (const [depName, depRange] of Object.entries(node?.dependencies ?? {})) {
            const childKey = opts.resolveEdge(key, depName, depRange);
            if (childKey === undefined)
                continue;
            addEdge(key, childKey);
            if (!onStack.has(childKey))
                visit(childKey);
        }
        onStack.delete(key);
    }
    for (const [depName, depRange] of Object.entries(opts.rootDependencies)) {
        const childKey = opts.resolveEdge(opts.rootKey, depName, depRange);
        if (childKey === undefined)
            continue;
        addEdge(opts.rootKey, childKey);
        visit(childKey);
    }
    // ---- Pass 2: topological DP over DAG edges (root is a virtual parent with count 1) ----
    const info = new Map();
    info.set(opts.rootKey, { examples: [[]], pathCountAtLeast: 1 });
    const childrenOf = new Map();
    for (const [child, parents] of dagParents) {
        for (const parent of parents) {
            const arr = childrenOf.get(parent);
            if (arr)
                arr.push(child);
            else
                childrenOf.set(parent, [child]);
        }
    }
    const remaining = new Map();
    for (const [child, parents] of dagParents)
        remaining.set(child, parents.length);
    const queue = [];
    function finalize(node) {
        for (const child of childrenOf.get(node) ?? []) {
            const r = (remaining.get(child) ?? 0) - 1;
            remaining.set(child, r);
            if (r === 0)
                queue.push(child);
        }
    }
    finalize(opts.rootKey);
    while (queue.length > 0) {
        const node = queue.shift();
        const parents = dagParents.get(node);
        let count = 0;
        const examples = [];
        for (const parent of parents) {
            const parentInfo = info.get(parent);
            count = Math.min(COUNT_CAP, count + parentInfo.pathCountAtLeast);
            if (examples.length < MAX_EXAMPLES) {
                for (const ex of parentInfo.examples) {
                    if (examples.length >= MAX_EXAMPLES)
                        break;
                    examples.push([...ex, opts.nameForKey(node)]);
                }
            }
        }
        info.set(node, { examples, pathCountAtLeast: count });
        finalize(node);
    }
    // ---- Back-edge relaxation: one update per cycle-closing edge, not a fixpoint loop ----
    for (const [parent, child] of backEdges) {
        const parentInfo = info.get(parent);
        const childInfo = info.get(child);
        if (!parentInfo || !childInfo)
            continue;
        const newCount = Math.min(COUNT_CAP, childInfo.pathCountAtLeast + parentInfo.pathCountAtLeast);
        const newExamples = [...childInfo.examples];
        for (const ex of parentInfo.examples) {
            if (newExamples.length >= MAX_EXAMPLES)
                break;
            newExamples.push([...ex, opts.nameForKey(child)]);
        }
        info.set(child, { examples: newExamples, pathCountAtLeast: newCount });
    }
    info.delete(opts.rootKey);
    return info;
}
//# sourceMappingURL=dependencyGraph.js.map