/**
 * Single AudioContext invariant census.
 *
 * `src/infra/AGENTS.md`'s "AudioContext Singleton" invariant and this module's
 * own "Single AudioContext" trap both require exactly one live production
 * `AudioContext` app-wide. This walks `src/` from its own location, the same
 * shape `offlineContextPreparation.spec.ts` uses, so a second live
 * construction anywhere in the tree reds this rather than waiting for a
 * runtime collision.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = join(import.meta.dirname, '../../../..');

const LIVE_CONTEXT_OWNER = 'modules/AudioEngine/repositories/createWebAudioEngine.ts';
const REPOSITORIES_DIR_PREFIX = 'modules/AudioEngine/repositories/';

function isExcludedDirectory(entryName: string): boolean {
    return entryName === '__tests__' || entryName === 'node_modules';
}

/**
 * `setupTests.ts` is the jsdom harness that stubs both `AudioContext` and
 * `OfflineAudioContext` globally for every other test; it names both in a
 * stub and a comment and is not a production caller.
 */
function isCensusSourceFile(entryName: string): boolean {
    if (entryName === 'setupTests.ts') {
        return false;
    }
    return (entryName.endsWith('.ts') || entryName.endsWith('.tsx')) && !entryName.includes('.spec.');
}

function collectTypeScriptFiles(directory: string, into: string[]): string[] {
    for (const entry of readdirSync(directory)) {
        const path = join(directory, entry);
        if (statSync(path).isDirectory()) {
            if (isExcludedDirectory(entry)) {
                continue;
            }
            collectTypeScriptFiles(path, into);
            continue;
        }
        if (isCensusSourceFile(entry)) {
            into.push(path);
        }
    }
    return into;
}

/** Narrow, regex-based strip — adequate for a census that only ever searches
 *  for a handful of literal construction phrases, not a general parser. */
function stripComments(source: string): string {
    return source.replaceAll(/\/\*[\s\S]*?\*\//g, '').replaceAll(/\/\/.*$/gm, '');
}

function countMatches(source: string, pattern: RegExp): number {
    return source.match(pattern)?.length ?? 0;
}

// The opening parenthesis is required so a prose mention — e.g.
// `workletInitShared.ts`'s "create a new AudioContext before loading" error
// text — is not a match.
const LIVE_CONTEXT_PATTERNS = [
    /new\s+AudioContext\s*\(/g,
    /new\s+window\.AudioContext\s*\(/g,
    /new\s+webkitAudioContext\s*\(/g,
];

const OFFLINE_CONTEXT_PATTERN = /new\s+OfflineAudioContext\s*\(/g;

function countLiveContextConstructions(source: string): number {
    return LIVE_CONTEXT_PATTERNS.reduce((total, pattern) => total + countMatches(source, pattern), 0);
}

function countOfflineContextConstructions(source: string): number {
    return countMatches(source, OFFLINE_CONTEXT_PATTERN);
}

type ContextCensus = {
    files: string[];
    liveByFile: Map<string, number>;
    offlineByFile: Map<string, number>;
};

function buildContextCensus(): ContextCensus {
    const files = collectTypeScriptFiles(SRC_ROOT, []);
    const liveByFile = new Map<string, number>();
    const offlineByFile = new Map<string, number>();
    for (const absolutePath of files) {
        const relativePath = absolutePath.slice(SRC_ROOT.length + 1);
        const stripped = stripComments(readFileSync(absolutePath, 'utf8'));

        const liveCount = countLiveContextConstructions(stripped);
        if (liveCount > 0) {
            liveByFile.set(relativePath, liveCount);
        }

        const offlineCount = countOfflineContextConstructions(stripped);
        if (offlineCount > 0) {
            offlineByFile.set(relativePath, offlineCount);
        }
    }
    return { files, liveByFile, offlineByFile };
}

describe('single AudioContext invariant census', () => {
    it('visits enough of src/ and finds enough OfflineAudioContext sites to trust its own walk', () => {
        // Guards every assertion below: a broken walker that visits nothing, or a
        // pattern that matches nothing, would pass every assertion in this file
        // vacuously — exactly the failure mode a census like this exists to rule
        // out (see `undoableHandlersAudit.spec.ts`'s registry guard).
        const { files, offlineByFile } = buildContextCensus();
        const totalOfflineCount = [...offlineByFile.values()].reduce((sum, count) => sum + count, 0);

        expect(files.length).toBeGreaterThan(500);
        expect(totalOfflineCount).toBeGreaterThanOrEqual(8);
    });

    it('constructs the one live production AudioContext only in createWebAudioEngine.ts', () => {
        const { liveByFile } = buildContextCensus();

        // createWebAudioEngine.ts is the sole production owner of the live
        // AudioContext: every other module reaches it through
        // getAudioContext()/audioEngine instead of constructing its own, per
        // this module's "Single AudioContext" trap and src/infra/AGENTS.md's
        // "AudioContext Singleton" invariant.
        const expectedLiveContextOwners = [{ path: LIVE_CONTEXT_OWNER, count: 1 }];
        const actualLiveContextOwners = Array.from(liveByFile.entries(), ([path, count]) => ({ path, count })).sort(
            (a, b) => a.path.localeCompare(b.path)
        );

        expect(
            actualLiveContextOwners,
            `expected exactly one live AudioContext construction, at ${LIVE_CONTEXT_OWNER} with count 1; ` +
                `found ${JSON.stringify(actualLiveContextOwners)}`
        ).toEqual(expectedLiveContextOwners);
    });

    it('keeps every OfflineAudioContext construction out of repositories/, except the named capability probe', () => {
        const { offlineByFile } = buildContextCensus();

        // createWebAudioEngine.ts's fallback-mode `createNoopAudioContext` builds
        // a throwaway 1-frame OfflineAudioContext as a structurally-checked
        // AudioContext shim; it never carries live playback and does not
        // compete with the one live context asserted above.
        const permittedRepositoryOffenders = [
            {
                path: LIVE_CONTEXT_OWNER,
                reason: 'createNoopAudioContext builds a 1-frame OfflineAudioContext-based fallback shim, not a live context',
            },
        ];
        const permittedPaths = new Set(permittedRepositoryOffenders.map((entry) => entry.path));

        const offenders = Array.from(offlineByFile.keys())
            .filter((path) => path.startsWith(REPOSITORIES_DIR_PREFIX))
            .filter((path) => !permittedPaths.has(path));

        expect(
            offenders,
            `these files under ${REPOSITORIES_DIR_PREFIX} construct an OfflineAudioContext outside the named ` +
                `capability probe exception: ${offenders.join(', ')}`
        ).toEqual([]);
    });
});
