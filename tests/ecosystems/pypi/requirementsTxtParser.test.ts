import { describe, it, expect } from 'vitest';
import { parseRequirementsTxt } from '../../../src/ecosystems/pypi/requirementsTxtParser';

describe('parseRequirementsTxt', () => {
  it('parses clean name==version pins', () => {
    const { pinned, unresolvable } = parseRequirementsTxt('requests==2.31.0\nclick==8.1.7\n');
    expect(pinned).toEqual([
      { name: 'requests', version: '2.31.0' },
      { name: 'click', version: '8.1.7' },
    ]);
    expect(unresolvable).toEqual([]);
  });

  it('strips full-line and inline comments and blank lines', () => {
    const src = '# header comment\n\nrequests==2.31.0  # inline note\n\n';
    const { pinned } = parseRequirementsTxt(src);
    expect(pinned).toEqual([{ name: 'requests', version: '2.31.0' }]);
  });

  it('does not treat a # inside a URL fragment as a comment', () => {
    // `#egg=` fragments have no preceding whitespace, so they are part of the token.
    const { unresolvable } = parseRequirementsTxt('git+https://github.com/psf/requests.git#egg=requests\n');
    expect(unresolvable).toHaveLength(1);
    expect(unresolvable[0].raw).toContain('#egg=requests');
  });

  it('skips pip option / directive lines', () => {
    const src = [
      '-r other.txt',
      '-c constraints.txt',
      '--index-url https://pypi.org/simple',
      '--extra-index-url https://example.com',
      '-e .',
      'requests==2.31.0',
    ].join('\n');
    const { pinned, unresolvable } = parseRequirementsTxt(src);
    expect(pinned).toEqual([{ name: 'requests', version: '2.31.0' }]);
    expect(unresolvable).toEqual([]);
  });

  it('strips environment markers before extracting the pin', () => {
    const { pinned } = parseRequirementsTxt('click==8.1.7 ; python_version >= "3.8"\n');
    expect(pinned).toEqual([{ name: 'click', version: '8.1.7' }]);
  });

  it('ignores extras on the name side of a pin', () => {
    const { pinned } = parseRequirementsTxt('requests[security]==2.31.0\n');
    expect(pinned).toEqual([{ name: 'requests', version: '2.31.0' }]);
  });

  it('marks unpinned ranges as unresolvable with a best-effort name, never dropping them', () => {
    const src = 'some-range>=2.0\nunpinned\nother~=1.4\n';
    const { pinned, unresolvable } = parseRequirementsTxt(src);
    expect(pinned).toEqual([]);
    expect(unresolvable.map((u) => u.name)).toEqual(['some-range', 'unpinned', 'other']);
  });

  it('marks git URLs and local paths as unresolvable', () => {
    const src = 'git+https://github.com/psf/requests.git\n./local/pkg\nhttps://example.com/pkg.whl\n';
    const { pinned, unresolvable } = parseRequirementsTxt(src);
    expect(pinned).toEqual([]);
    expect(unresolvable).toHaveLength(3);
  });

  it('joins backslash line continuations', () => {
    const { pinned } = parseRequirementsTxt('requests==\\\n2.31.0\n');
    expect(pinned).toEqual([{ name: 'requests', version: '2.31.0' }]);
  });
});
