// Single shared source for "what counts as permissive" across the
// resolver (choosing the most-permissive OR branch) and the conflict
// rules engine (deciding whether a project's OWN declared license is
// permissive mode). These previously diverged — this file is the fix.
export const PERMISSIVE_IDS = new Set(['MIT', 'ISC', 'BSD-2-Clause', 'BSD-3-Clause', 'Apache-2.0', '0BSD', 'Unlicense']);
