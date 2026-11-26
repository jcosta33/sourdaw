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

import { type Dirent, readdirSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

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

// A directory entry does not follow symlinks, so a symlink resolves through
// statSync: a symlinked directory is walked and a dangling link fails the walk.
function isDirectoryEntry(entry: Dirent, path: string): boolean {
    return entry.isSymbolicLink() ? statSync(path).isDirectory() : entry.isDirectory();
}

function collectTypeScriptFiles(directory: string, into: string[]): string[] {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if (isDirectoryEntry(entry, path)) {
            if (isExcludedDirectory(entry.name)) {
                continue;
            }
            collectTypeScriptFiles(path, into);
            continue;
        }
        if (isCensusSourceFile(entry.name)) {
            into.push(path);
        }
    }
    return into;
}

// Reads overlap within a bounded batch instead of running one after another,
// without holding thousands of file handles open at once.
const READ_BATCH_SIZE = 64;

type SourceFile = { path: string; source: string };

async function readSourceFile(path: string): Promise<SourceFile> {
    return { path, source: await readFile(path, 'utf8') };
}

async function readSourceFiles(paths: string[]): Promise<SourceFile[]> {
    const sourceFiles: SourceFile[] = [];
    for (let start = 0; start < paths.length; start += READ_BATCH_SIZE) {
        const batch = paths.slice(start, start + READ_BATCH_SIZE);
        sourceFiles.push(...(await Promise.all(batch.map(readSourceFile))));
    }
    return sourceFiles;
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
// text — is not a match. The qualifier group covers `window.`, `globalThis.`
// and `self.` — the three global-object spellings a direct construction can
// carry — and the optional `webkit` prefix covers the vendor-prefixed
// constructor name, unqualified or qualified. A constructor reached through a
// local alias (e.g. `const Ctx = window.AudioContext; new Ctx()`) is
// deliberately out of scope: this is a literal census of direct construction
// sites, not a data-flow analysis of every name a constructor can travel
// through.
const LIVE_CONTEXT_PATTERNS = [/new\s+(?:(?:window|globalThis|self)\.)?(?:webkit)?AudioContext\s*\(/g];

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

// Both construction patterns spell `AudioContext`, so a file without the word
// cannot match either and skips the comment strip.
const CONTEXT_WORD = 'AudioContext';

async function buildContextCensus(): Promise<ContextCensus> {
    const files = collectTypeScriptFiles(SRC_ROOT, []);
    const liveByFile = new Map<string, number>();
    const offlineByFile = new Map<string, number>();
    for (const { path: absolutePath, source } of await readSourceFiles(files)) {
        if (!source.includes(CONTEXT_WORD)) {
            continue;
        }
        const relativePath = absolutePath.slice(SRC_ROOT.length + 1);
        const stripped = stripComments(source);

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
    let census: ContextCensus;

    beforeAll(async () => {
        census = await buildContextCensus();
    });

    it('visits enough of src/ and finds enough OfflineAudioContext sites to trust its own walk', () => {
        // Guards every assertion below: a broken walker that visits nothing, or a
        // pattern that matches nothing, would pass every assertion in this file
        // vacuously — exactly the failure mode a census like this exists to rule
        // out (see `undoableHandlersAudit.spec.ts`'s registry guard).
        const { files, offlineByFile } = census;
        const totalOfflineCount = [...offlineByFile.values()].reduce((sum, count) => sum + count, 0);

        expect(files.length).toBeGreaterThan(500);
        expect(totalOfflineCount).toBeGreaterThanOrEqual(8);
    });

    it('constructs the one live production AudioContext only in createWebAudioEngine.ts', () => {
        const { liveByFile } = census;

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
        const { offlineByFile } = census;

        // `webAudioEngine/createNoopAudioContext.ts` builds a throwaway 1-frame
        // OfflineAudioContext as a structurally-checked AudioContext shim for
        // createWebAudioEngine.ts's fallback mode; it never carries live
        // playback and does not compete with the one live context asserted
        // above. The permitted count bounds the exemption to that one shim: the
        // same file constructing a second, unrelated OfflineAudioContext is
        // still an offender.
        const permittedRepositoryOffenders = [
            {
                path: 'modules/AudioEngine/repositories/webAudioEngine/createNoopAudioContext.ts',
                count: 1,
                reason: 'createNoopAudioContext builds a 1-frame OfflineAudioContext-based fallback shim, not a live context',
            },
        ];
        const permittedCountByPath = new Map(permittedRepositoryOffenders.map((entry) => [entry.path, entry.count]));

        const repositoryEntries = Array.from(offlineByFile.entries()).filter(([path]) =>
            path.startsWith(REPOSITORIES_DIR_PREFIX)
        );
        const repositoryCounts = repositoryEntries.map(([path, count]) => ({
            path,
            count,
            permittedCount: permittedCountByPath.get(path),
        }));
        const offenders = repositoryCounts.filter((entry) => entry.permittedCount !== entry.count);

        expect(
            offenders,
            `these files under ${REPOSITORIES_DIR_PREFIX} construct an OfflineAudioContext outside the named ` +
                `capability probe exception, or at a count other than its permitted count: ${JSON.stringify(offenders)}`
        ).toEqual([]);
    });
});
