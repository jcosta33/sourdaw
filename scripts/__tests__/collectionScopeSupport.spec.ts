import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    agentExcludeRoots,
    agentRootsToCheck,
    classifyExcludeGlobs,
    describeExcludeMirrorDrift,
    describeScopeVerdicts,
    findLeftoverFixtures,
    listFixtureDirectories,
    plantWorktreeFixture,
    type ScopeVerdictInput,
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

    it('derives roots from the prefixes it is given, not from a fixed pair', () => {
        expect(agentExcludeRoots(['x/', '.agents/other/'])).toEqual(['.agents/other']);
    });
});

describe('agentRootsToCheck', () => {
    it('adds the required roots to the agent roots the mirror names, once each', () => {
        expect(agentRootsToCheck(['.agents/a', '.agents/b'], ['dist/', '.agents/b/', '.agents/c/'])).toEqual([
            '.agents/a',
            '.agents/b',
            '.agents/c',
        ]);
    });
});

describe('describeScopeVerdicts', () => {
    const requiredRoots = ['.agents/worktrees', '.agents/review-worktrees'];
    const cleanInput: ScopeVerdictInput = {
        mirrorDrift: [],
        requiredRoots,
        mirrorPrefixes: ['dist/', '.agents/worktrees/', '.agents/review-worktrees/'],
        configPrefixes: ['dist/', '.agents/worktrees/', '.agents/review-worktrees/'],
        plantedFixtures: requiredRoots.map((root) => ({
            root,
            specPath: `${root}/collection-scope-guard-x/src/collectionScopeGuard.spec.ts`,
        })),
        collected: ['src/a.spec.ts'],
    };

    it('passes when both roots are required, excluded, planted, and uncollected', () => {
        expect(describeScopeVerdicts(cleanInput)).toEqual([]);
    });

    it('fails on mirror drift, carrying the drift line', () => {
        const failures = describeScopeVerdicts({ ...cleanInput, mirrorDrift: ['  ✗ drift line'] });
        expect(failures).toEqual(['  ✗ drift line']);
    });

    it('fails when the mirror lacks a required root, even though the config and mirror agree', () => {
        const failures = describeScopeVerdicts({
            ...cleanInput,
            mirrorPrefixes: ['dist/', '.agents/worktrees/'],
            configPrefixes: ['dist/', '.agents/worktrees/'],
        });
        expect(failures).toHaveLength(2);
        expect(failures[0]).toContain("vitestExcludePrefixes has no '.agents/review-worktrees/'");
        expect(failures[1]).toContain("vite.config.ts has no '.agents/review-worktrees/**'");
    });

    it('fails when only the resolved config lacks a required root', () => {
        const failures = describeScopeVerdicts({ ...cleanInput, configPrefixes: ['dist/', '.agents/worktrees/'] });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain("vite.config.ts has no '.agents/review-worktrees/**'");
    });

    it('fails when a required root has no planted fixture', () => {
        const failures = describeScopeVerdicts({
            ...cleanInput,
            plantedFixtures: cleanInput.plantedFixtures.slice(0, 1),
        });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('no fixture was planted under .agents/review-worktrees/');
    });

    it('fails when the root run collected a spec under an agent root', () => {
        const leaked = '.agents/review-worktrees/collection-scope-guard-x/src/collectionScopeGuard.spec.ts';
        const failures = describeScopeVerdicts({ ...cleanInput, collected: ['src/a.spec.ts', leaked] });
        expect(failures).toHaveLength(1);
        expect(failures[0]).toContain('collected 1 spec(s) under .agents/review-worktrees/');
        expect(failures[0]).toContain(leaked);
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
