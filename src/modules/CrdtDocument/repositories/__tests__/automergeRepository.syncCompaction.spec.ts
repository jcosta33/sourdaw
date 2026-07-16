import * as Automerge from '@automerge/automerge';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { automergeRepository } from '../automergeRepository';

// Wrap save/load in spies that delegate to the real implementation so we can
// assert the sync fallback path compacts a merged doc through a save→load
// round-trip, exactly as the worker path does (crdtWorker.processMerge saves
// every doc, then mergeBundle loads the compacted bytes back — line ~706).
vi.mock('@automerge/automerge', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@automerge/automerge')>();
    return {
        ...actual,
        save: vi.fn(actual.save),
        load: vi.fn(actual.load),
    };
});

// Force the CRDT worker to be unavailable so mergeBundle takes the synchronous
// fallback (`_mergeBundleSync`). The constructor throwing makes
// getCrdtWorkerInstance throw, which invokeWorker rejects, which mergeBundle
// catches and falls back from.
vi.stubGlobal(
    'Worker',
    vi.fn(() => {
        throw new Error('worker unavailable in test');
    })
);

describe('AutomergeRepository sync merge compaction', () => {
    beforeEach(() => {
        automergeRepository.reset();
        vi.clearAllMocks();
    });

    afterEach(() => {
        automergeRepository.reset();
    });

    it('compacts a merged doc through a save→load round-trip on the sync fallback', async () => {
        // Seed a local root document with content.
        automergeRepository.createProject('local project');
        automergeRepository.changeDoc('root' as never, (doc: Record<string, unknown>) => {
            doc.local = 'value';
        });

        // Build an independent incoming doc for the same id so the merge branch
        // (not the new-doc branch) is exercised.
        let remote = Automerge.init<Record<string, unknown>>();
        remote = Automerge.change(remote, (doc) => {
            doc.remote = 'value';
        });
        const bundle = new Map<string, Uint8Array>([['root', Automerge.save(remote)]]);

        const saveMock = vi.mocked(Automerge.save);
        const loadMock = vi.mocked(Automerge.load);
        saveMock.mockClear();
        loadMock.mockClear();

        const result = await automergeRepository.mergeBundle(bundle as never);

        // The merge branch ran (existing local doc), not the new-doc branch.
        expect(result.mergedDocIds).toContain('root');
        expect(result.newDocIds).not.toContain('root');

        // The stored doc must be the product of load(save(...)) — i.e. the
        // exact object returned by a load() call whose input was a save()
        // output. Before the fix it was the raw merge() result (never saved
        // then reloaded), so no such round-trip exists.
        const stored = automergeRepository.getDoc('root' as never);
        const saveOutputs: unknown[] = saveMock.mock.results.map((entry): unknown => entry.value);
        let roundTripped = false;
        for (const [index, call] of loadMock.mock.calls.entries()) {
            const loadedFromSaveOutput = saveOutputs.includes(call[0]);
            const producedStoredDoc = loadMock.mock.results[index]?.value === stored;
            if (loadedFromSaveOutput && producedStoredDoc) {
                roundTripped = true;
            }
        }
        expect(roundTripped).toBe(true);

        // Content from both sides survived the compaction.
        const merged = automergeRepository.getDoc('root' as never) as Record<string, unknown>;
        expect(merged.local).toBe('value');
        expect(merged.remote).toBe('value');
    });
});
