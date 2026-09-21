import { describe, expect, it } from 'vitest';

import { parseNameStatus } from '../semanticReview/gitSource.ts';
import { parseCommandLine } from '../semanticReview.ts';

describe('command line', () => {
    it('parses a pull-request scan', () => {
        const parsed = parseCommandLine(['scan', '--pr', '42']);
        expect(parsed.command).toBe('scan');
        expect(parsed.pr).toBe(42);
        expect(parsed.profile).toBe('ci');
        expect(parsed.dryRun).toBe(false);
    });

    it('parses a dry run with an explicit local profile', () => {
        const parsed = parseCommandLine([
            'scan',
            '--base',
            'main',
            '--head',
            'HEAD',
            '--profile',
            'local',
            '--dry-run',
        ]);
        expect(parsed.base).toBe('main');
        expect(parsed.head).toBe('HEAD');
        expect(parsed.profile).toBe('local');
        expect(parsed.dryRun).toBe(true);
    });

    it('parses a verification of candidate findings', () => {
        const parsed = parseCommandLine(['verify', '--bundle', '/tmp/bundle', '--findings', '/tmp/findings.json']);
        expect(parsed.command).toBe('verify');
        expect(parsed.bundlePath).toBe('/tmp/bundle');
        expect(parsed.findingsPath).toBe('/tmp/findings.json');
    });

    it('accepts an explicit trusted execution sha for CI runs', () => {
        // In a pull_request_target run origin/main can advance past the checked-out tree, so CI names
        // the revision it actually ran instead of letting the branch tip speak for it.
        const sha = 'a'.repeat(40);
        const parsed = parseCommandLine(['scan', '--pr', '7', '--trusted-sha', sha]);
        expect(parsed.trustedSha).toBe(sha);
    });

    it('leaves the trusted revision unset when the caller does not name one', () => {
        expect(parseCommandLine(['scan', '--pr', '7']).trustedSha).toBeUndefined();
    });

    it('refuses an unknown subcommand', () => {
        expect(() => parseCommandLine(['publish'])).toThrow(/Usage/u);
    });

    it('refuses an unknown option rather than ignoring it', () => {
        expect(() => parseCommandLine(['scan', '--pr', '1', '--force'])).toThrow(/unknown option/u);
    });

    it('refuses a non-positive pull request number', () => {
        expect(() => parseCommandLine(['scan', '--pr', '0'])).toThrow(/positive integer/u);
    });

    it('refuses an unknown profile', () => {
        expect(() => parseCommandLine(['scan', '--pr', '1', '--profile', 'turbo'])).toThrow(/ci or local/u);
    });

    it('refuses an option missing its value', () => {
        expect(() => parseCommandLine(['scan', '--pr'])).toThrow(/requires a value/u);
    });
});

describe('name-status parsing', () => {
    it('reads additions, deletions, and modifications', () => {
        const statuses = parseNameStatus('A\0src/new.ts\0M\0src/changed.ts\0D\0src/gone.ts\0');
        expect(statuses.get('src/new.ts')).toEqual({ kind: 'added' });
        expect(statuses.get('src/changed.ts')).toEqual({ kind: 'modified' });
        expect(statuses.get('src/gone.ts')).toEqual({ kind: 'deleted' });
    });

    it('reads a rename as the new path carrying its previous path', () => {
        // AC-03: a rename is one change with both identities, not an unrelated add plus delete.
        const statuses = parseNameStatus('R100\0src/old.ts\0src/new.ts\0');
        expect(statuses.get('src/new.ts')).toEqual({ kind: 'renamed', previousPath: 'src/old.ts' });
        expect(statuses.has('src/old.ts')).toBe(false);
    });

    it('reads a copy as the new path carrying its source path', () => {
        // A copy has both sides: the source is unchanged and the destination is new. Reporting it as
        // `added` waived the before side, so it must carry its own kind and source path.
        const statuses = parseNameStatus('C100\0src/a.ts\0src/b.ts\0');
        expect(statuses.get('src/b.ts')).toEqual({ kind: 'copied', previousPath: 'src/a.ts' });
        expect(statuses.has('src/a.ts')).toBe(false);
    });

    it('stops cleanly on a truncated record rather than inventing an entry', () => {
        const statuses = parseNameStatus('M\0src/changed.ts\0R100\0src/old.ts\0');
        expect(statuses.size).toBe(1);
    });
});
