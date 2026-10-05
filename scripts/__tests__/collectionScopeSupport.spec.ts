import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    agentExcludeRoots,
    classifyExcludeGlobs,
    describeExcludeMirrorDrift,
    findLeftoverFixtures,
    listFixtureDirectories,
    plantWorktreeFixture,
} from '../collectionScopeSupport.ts';

const knownFileGlobs = ['**/node_modules/**', '**/*.e2e.spec.*'];
const cleanGlobs = ['**/node_modules/**', 'dist/**', '.agents/worktrees/**', '**/*.e2e.spec.*'];
const cleanMirror = ['dist/', '.agents/worktrees/'];

describe('classifyExcludeGlobs', () => {
    it('splits known file globs, directory prefixes, and unrecognised shapes', () => {
        expect(classifyExcludeGlobs([...cleanGlobs, 'probe-dir/**/*', 'probe-dir'], knownFileGlobs)).toEqual({
            prefixes: ['dist/', '.agents/worktrees/'],
            unrecognised: ['probe-dir/**/*', 'probe-dir'],
        });
    });
});

describe('describeExcludeMirrorDrift', () => {
    it('reports nothing when every entry is classified and the prefixes equal the mirror', () => {
        expect(describeExcludeMirrorDrift(cleanGlobs, knownFileGlobs, cleanMirror)).toEqual([]);
    });

    it('names a prefix the config excludes and the mirror lacks', () => {
        const drift = describeExcludeMirrorDrift([...cleanGlobs, 'probe-dir/**'], knownFileGlobs, cleanMirror);
        expect(drift).toHaveLength(1);
        expect(drift[0]).toContain("'probe-dir/'");
        expect(drift[0]).toContain('has no');
    });

    it('names a prefix the mirror lists and the config does not exclude', () => {
        const drift = describeExcludeMirrorDrift(cleanGlobs, knownFileGlobs, [...cleanMirror, 'ghost/']);
        expect(drift).toHaveLength(1);
        expect(drift[0]).toContain("'ghost/'");
        expect(drift[0]).toContain('lists');
    });

    it.each(['probe-dir/**/*', 'probe-dir'])('refuses the unrecognised exclude shape %s, naming it', (entry) => {
        const drift = describeExcludeMirrorDrift([...cleanGlobs, entry], knownFileGlobs, cleanMirror);
        expect(drift).toHaveLength(1);
        expect(drift[0]).toContain(`'${entry}'`);
        expect(drift[0]).toContain('neither a known file-level glob nor');
    });
});

describe('agentExcludeRoots', () => {
    it('keeps only the .agents prefixes, without the trailing slash', () => {
        expect(agentExcludeRoots(['dist/', '.agents/worktrees/', '.agents/review-worktrees/', 'tests/e2e/'])).toEqual([
            '.agents/worktrees',
            '.agents/review-worktrees',
        ]);
    });
});

describe('findLeftoverFixtures', () => {
    it('reports only fixture directories the run added', () => {
        expect(
            findLeftoverFixtures(
                ['a/collection-scope-guard-old'],
                ['a/collection-scope-guard-old', 'a/collection-scope-guard-new']
            )
        ).toEqual(['a/collection-scope-guard-new']);
    });
});

describe('plantWorktreeFixture', () => {
    let repoRoot = '';

    beforeEach(() => {
        repoRoot = mkdtempSync(join(tmpdir(), 'collection-scope-support-'));
    });

    afterEach(() => {
        rmSync(repoRoot, { recursive: true, force: true });
    });

    it('writes the spec under a fresh directory beneath the root', () => {
        const fixture = plantWorktreeFixture(repoRoot, '.agents/worktrees');

        expect(fixture.specPath.startsWith('.agents/worktrees/collection-scope-guard-')).toBe(true);
        expect(existsSync(join(repoRoot, fixture.specPath))).toBe(true);
        expect(listFixtureDirectories(repoRoot, ['.agents/worktrees'])).toHaveLength(1);
    });

    it('removes its own directory when writing the spec fails after the directory exists', () => {
        let directoryExistedAtWrite = false;

        expect(() =>
            plantWorktreeFixture(repoRoot, '.agents/worktrees', (absoluteSpecPath) => {
                directoryExistedAtWrite = existsSync(dirname(dirname(absoluteSpecPath)));
                throw new Error('writer failed');
            })
        ).toThrow('writer failed');

        expect(directoryExistedAtWrite).toBe(true);
        expect(listFixtureDirectories(repoRoot, ['.agents/worktrees'])).toEqual([]);
    });
});
