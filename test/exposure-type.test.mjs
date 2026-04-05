import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { exposureType } from './helpers.mjs';

describe('exposureType — dependency range classification', () => {
  // ── Auto-pull ranges ──────────────────────────────────────────────────
  // These ranges allow npm to silently pull a new (potentially compromised)
  // patch or minor version on a fresh `npm install`.

  describe('auto ranges', () => {
    it('caret ranges (^)', () => {
      assert.equal(exposureType('^1.4.0'), 'auto');
      assert.equal(exposureType('^0.0.1'), 'auto');
      assert.equal(exposureType('^16.0.0'), 'auto');
    });

    it('tilde ranges (~)', () => {
      assert.equal(exposureType('~1.4.0'), 'auto');
      assert.equal(exposureType('~0.2.3'), 'auto');
    });

    it('greater-than ranges (>=, >)', () => {
      assert.equal(exposureType('>=1.0.0'), 'auto');
      assert.equal(exposureType('>2.0.0'), 'auto');
      assert.equal(exposureType('>=0.10.0'), 'auto');
    });

    it('wildcard / star / latest', () => {
      assert.equal(exposureType('*'), 'auto');
      assert.equal(exposureType('latest'), 'auto');
      assert.equal(exposureType(''), 'auto');
      assert.equal(exposureType(null), 'auto');
      assert.equal(exposureType(undefined), 'auto');
    });

    it('bare numbers (npm treats as range)', () => {
      // "1" → >=1.0.0 <2.0.0, "1.4" → >=1.4.0 <1.5.0
      assert.equal(exposureType('1'), 'auto');
      assert.equal(exposureType('1.4'), 'auto');
      assert.equal(exposureType('1.x'), 'auto');
      assert.equal(exposureType('1.x.x'), 'auto');
      assert.equal(exposureType('1.*'), 'auto');
    });
  });

  // ── Pinned versions ───────────────────────────────────────────────────
  // Exact version strings — npm installs this version and nothing else.

  describe('pinned versions', () => {
    it('exact three-part version', () => {
      assert.equal(exposureType('1.4.0'), 'pinned');
      assert.equal(exposureType('0.0.1'), 'pinned');
      assert.equal(exposureType('22.13.1'), 'pinned');
      assert.equal(exposureType('1.0.8'), 'pinned');
    });
  });

  // ── Needs-update ──────────────────────────────────────────────────────
  // Anything else: URLs, git refs, workspace protocols, complex ranges
  // that don't fit auto or pinned.

  describe('needs-update (other)', () => {
    it('hyphen ranges', () => {
      assert.equal(exposureType('1.0.0 - 2.0.0'), 'needs-update');
    });

    it('double-pipe ranges starting with >= are still auto', () => {
      // ">=1.0.0 <2.0.0 || >=3.0.0" starts with >= → classified as auto
      // (conservative: this range does accept new versions)
      assert.equal(exposureType('>=1.0.0 <2.0.0 || >=3.0.0'), 'auto');
    });

    it('less-than ranges are needs-update', () => {
      assert.equal(exposureType('<2.0.0'), 'needs-update');
      assert.equal(exposureType('<=1.5.0'), 'needs-update');
    });

    it('URLs and protocols', () => {
      assert.equal(
        exposureType('git+https://github.com/user/repo.git'),
        'needs-update',
      );
      assert.equal(exposureType('https://example.com/foo.tgz'), 'needs-update');
    });

    it('workspace protocol', () => {
      assert.equal(exposureType('workspace:*'), 'needs-update');
      assert.equal(exposureType('workspace:^'), 'needs-update');
    });

    it('npm aliases', () => {
      assert.equal(exposureType('npm:lodash@^4.0.0'), 'needs-update');
    });
  });

  // ── Whitespace handling ───────────────────────────────────────────────

  describe('whitespace tolerance', () => {
    it('trims leading/trailing spaces', () => {
      assert.equal(exposureType('  ^1.4.0  '), 'auto');
      assert.equal(exposureType(' 1.4.0 '), 'pinned');
    });
  });
});
