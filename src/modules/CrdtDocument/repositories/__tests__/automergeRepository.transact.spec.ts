/**
 * Integration regression tests for AutomergeRepository's snapshot/merge/reset
 * paths, run against *real* Automerge (no `vi.mock('@automerge/automerge')`),
 * because the bugs under test are about the actual binary change graph and the
 * rAF-deferred write ordering — both of which a mock would paper over.
 */
import { init, change, load, save, merge, getChanges, getHeads, view } from '@automerge/automerge';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import {
    getCurrentAutomergeStorageMutationOwner,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { automergeRepository } from '../automergeRepository';

type TestSnapshotEntry = { readonly state: 'present'; readonly bytes: Uint8Array } | { readonly state: 'absent' };

type TestDocumentSnapshot = Map<string, TestSnapshotEntry>;

function loadPresentSnapshot(snapshot: TestDocumentSnapshot, id: string): Record<string, unknown> {
    const entry = snapshot.get(id);
    expect(entry?.state).toBe('present');
    if (!entry || entry.state !== 'present') {
        throw new Error(`Expected present snapshot entry for ${id}`);
    }
    return load<Record<string, unknown>>(entry.bytes);
}

function expectAbsentSnapshot(snapshot: TestDocumentSnapshot, id: string): void {
    expect(snapshot.get(id)).toEqual({ state: 'absent' });
}

// The worker is unavailable in jsdom; force the synchronous fallback paths by
// stubbing Worker with one that immediately errors. invokeWorker rejects, and
// loadAll/mergeBundle fall back to _loadAllSync/_mergeBundleSync.
vi.stubGlobal(
    'Worker',
    vi.fn(() => {
        throw new Error('no worker in test');
    })
);

beforeEach(() => {
    automergeRepository.reset();
});

describe('AutomergeRepository mutation ownership', () => {
    it('attributes direct repository mutations to each exact storage transaction owner', () => {
        automergeRepository.createProject('p');
        const totalMutationBaseline = automergeRepository.getMutationEpoch();
        const unownedMutationBaseline = automergeRepository.getUnownedMutationEpoch();
        let firstOwner: object | undefined;
        let secondOwner: object | undefined;

        const firstTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            firstOwner = getCurrentAutomergeStorageMutationOwner();
            automergeRepository.createChildDoc('candidate-1');
        });
        firstTransaction.commit();
        const secondTransaction = runWithAutomergeStorageTransaction(undefined, () => {
            secondOwner = getCurrentAutomergeStorageMutationOwner();
            automergeRepository.createChildDoc('candidate-2');
        });
        secondTransaction.commit();

        expect(firstOwner).toBeDefined();
        expect(secondOwner).toBeDefined();
        if (!firstOwner || !secondOwner) {
            throw new Error('Expected both storage transactions to expose exact owners');
        }
        expect(secondOwner).not.toBe(firstOwner);
        expect(automergeRepository.getMutationEpoch()).toBe(totalMutationBaseline + 2);
        expect(automergeRepository.getUnownedMutationEpoch()).toBe(unownedMutationBaseline);
        expect(automergeRepository.getMutationEpochForOwner(firstOwner)).toBe(1);
        expect(automergeRepository.getMutationEpochForOwner(secondOwner)).toBe(1);
    });
});

describe('transactSnapshot - explicit mutation ownership', () => {
    it('does not let a retained handle capture a write after its transaction closes', async () => {
        automergeRepository.createProject('p');
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.count = 1;
        });

        let runDeferredWrite!: () => void;
        const { before, after } = await automergeRepository.transactSnapshot((transaction) => {
            runDeferredWrite = () => {
                automergeRepository.changeDoc(
                    'root',
                    (doc: Record<string, unknown>) => {
                        doc.count = 2;
                    },
                    undefined,
                    transaction
                );
            };
            return Promise.resolve();
        });

        runDeferredWrite();

        expect(before.size).toBe(0);
        expect(after.size).toBe(0);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ count: 2 });
    });

    it('does not clone undirtied docs into the before bundle', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('child-a');
        automergeRepository.createChildDoc('child-b');

        const { before, after } = await automergeRepository.transactSnapshot((transaction) => {
            automergeRepository.changeDoc(
                'child-a',
                (doc: Record<string, unknown>) => {
                    doc.touched = true;
                },
                undefined,
                transaction
            );
            return Promise.resolve();
        });

        expect([...before.keys()]).toEqual(['child-a']);
        expect([...after.keys()]).toEqual(['child-a']);
    });

    it('fences a reserved exact revision while leaving unrelated documents writable', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('branch_feature');
        let releaseTransaction!: () => void;
        let transactionStarted!: () => void;
        const started = new Promise<void>((resolve) => {
            transactionStarted = resolve;
        });
        const release = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });
        const pending = automergeRepository.transactSnapshot(async (transaction) => {
            automergeRepository.reserveSnapshotTransactionDocuments(transaction, ['root']);
            transactionStarted();
            await release;
        });
        await started;

        expect(() =>
            automergeRepository.changeDoc('root', (document: Record<string, unknown>) => {
                document.overlap = true;
            })
        ).toThrow('overlaps the active snapshot transaction');
        expect(() =>
            automergeRepository.changeDoc('branch_feature', (document: Record<string, unknown>) => {
                document.allowed = true;
            })
        ).not.toThrow();

        releaseTransaction();
        await pending;
    });

    it('excludes an unrelated mutation while an owned transaction is paused', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('owned');
        automergeRepository.createChildDoc('unrelated');
        automergeRepository.changeDoc('owned', (doc: Record<string, unknown>) => {
            doc.value = 'before';
        });
        automergeRepository.changeDoc('unrelated', (doc: Record<string, unknown>) => {
            doc.value = 'before';
        });

        let releaseTransaction!: () => void;
        let markTransactionStarted!: () => void;
        const transactionStarted = new Promise<void>((resolve) => {
            markTransactionStarted = resolve;
        });
        const transactionRelease = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });

        const pending = automergeRepository.transactSnapshot(async (transaction) => {
            automergeRepository.changeDoc(
                'owned',
                (doc: Record<string, unknown>) => {
                    doc.value = 'during';
                },
                undefined,
                transaction
            );
            markTransactionStarted();
            await transactionRelease;
            automergeRepository.changeDoc(
                'owned',
                (doc: Record<string, unknown>) => {
                    doc.value = 'after';
                },
                undefined,
                transaction
            );
        });

        await transactionStarted;
        automergeRepository.changeDoc('unrelated', (doc: Record<string, unknown>) => {
            doc.value = 'independent';
        });
        releaseTransaction();

        const { before, after } = await pending;
        expect([...before.keys()]).toEqual(['owned']);
        expect([...after.keys()]).toEqual(['owned']);

        automergeRepository.restoreSnapshot(before);
        expect(automergeRepository.getDoc<Record<string, unknown>>('owned')).toMatchObject({ value: 'before' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('unrelated')).toMatchObject({
            value: 'independent',
        });

        automergeRepository.restoreSnapshot(after);
        expect(automergeRepository.getDoc<Record<string, unknown>>('owned')).toMatchObject({ value: 'after' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('unrelated')).toMatchObject({
            value: 'independent',
        });
    });

    it('rejects an unowned write to a document already dirtied by the active transaction', async () => {
        automergeRepository.createProject('p');
        let markTransactionStarted!: () => void;
        let releaseTransaction!: () => void;
        const transactionStarted = new Promise<void>((resolve) => {
            markTransactionStarted = resolve;
        });
        const transactionRelease = new Promise<void>((resolve) => {
            releaseTransaction = resolve;
        });

        const pending = automergeRepository.transactSnapshot(async (transaction) => {
            automergeRepository.changeDoc(
                'root',
                (doc: Record<string, unknown>) => {
                    doc.owned = true;
                },
                undefined,
                transaction
            );
            markTransactionStarted();
            await transactionRelease;
        });

        await transactionStarted;
        expect(() => {
            automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                doc.unowned = true;
            });
        }).toThrow(/active snapshot transaction/i);
        releaseTransaction();
        await pending;

        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ owned: true });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('unowned');
    });
});

describe('transactSnapshot - membership-aware undo and redo', () => {
    it('captures child creation as absent before and present after', async () => {
        automergeRepository.createProject('p');

        const { before, after } = await automergeRepository.transactSnapshot((transaction) => {
            automergeRepository.createChildDoc('created', transaction);
            automergeRepository.changeDoc(
                'created',
                (doc: Record<string, unknown>) => {
                    doc.value = 'created';
                },
                undefined,
                transaction
            );
            return Promise.resolve();
        });

        expectAbsentSnapshot(before, 'created');
        expect(loadPresentSnapshot(after, 'created')).toMatchObject({ value: 'created' });

        automergeRepository.restoreSnapshot(before);
        expect(automergeRepository.hasDoc('created')).toBe(false);
        automergeRepository.restoreSnapshot(after);
        expect(automergeRepository.getDoc<Record<string, unknown>>('created')).toMatchObject({ value: 'created' });
    });

    it('captures insertion into an absent slot and restores both memberships', async () => {
        automergeRepository.createProject('p');
        let inserted = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
        inserted = change(inserted, (doc) => {
            doc.value = 'inserted';
        });

        const { before, after } = await automergeRepository.transactSnapshot((transaction) => {
            automergeRepository.insertDoc('inserted', inserted, transaction);
            return Promise.resolve();
        });

        expectAbsentSnapshot(before, 'inserted');
        expect(loadPresentSnapshot(after, 'inserted')).toMatchObject({ value: 'inserted' });
        automergeRepository.restoreSnapshot(before);
        expect(automergeRepository.hasDoc('inserted')).toBe(false);
        automergeRepository.restoreSnapshot(after);
        expect(automergeRepository.getDoc<Record<string, unknown>>('inserted')).toMatchObject({ value: 'inserted' });
    });

    it('captures removal as present before and absent after', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('removed');
        automergeRepository.changeDoc('removed', (doc: Record<string, unknown>) => {
            doc.value = 'kept for undo';
        });

        const { before, after } = await automergeRepository.transactSnapshot((transaction) => {
            automergeRepository.removeDoc('removed', transaction);
            return Promise.resolve();
        });

        expect(loadPresentSnapshot(before, 'removed')).toMatchObject({ value: 'kept for undo' });
        expectAbsentSnapshot(after, 'removed');
        automergeRepository.restoreSnapshot(before);
        expect(automergeRepository.getDoc<Record<string, unknown>>('removed')).toMatchObject({
            value: 'kept for undo',
        });
        automergeRepository.restoreSnapshot(after);
        expect(automergeRepository.hasDoc('removed')).toBe(false);
    });

    it('atomically restores mixed content, creation, and removal snapshots', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('changed');
        automergeRepository.createChildDoc('removed');
        automergeRepository.createChildDoc('untouched');
        automergeRepository.changeDoc('changed', (doc: Record<string, unknown>) => {
            doc.value = 'before';
        });
        automergeRepository.changeDoc('removed', (doc: Record<string, unknown>) => {
            doc.value = 'before';
        });
        automergeRepository.changeDoc('untouched', (doc: Record<string, unknown>) => {
            doc.value = 'independent';
        });

        const { before, after } = await automergeRepository.transactSnapshot((transaction) => {
            automergeRepository.changeDoc(
                'changed',
                (doc: Record<string, unknown>) => {
                    doc.value = 'after';
                },
                undefined,
                transaction
            );
            automergeRepository.createChildDoc('created', transaction);
            automergeRepository.changeDoc(
                'created',
                (doc: Record<string, unknown>) => {
                    doc.value = 'after';
                },
                undefined,
                transaction
            );
            automergeRepository.removeDoc('removed', transaction);
            return Promise.resolve();
        });

        automergeRepository.restoreSnapshot(before);
        expect(automergeRepository.getDocIds().sort()).toEqual(['changed', 'removed', 'root', 'untouched']);
        expect(automergeRepository.getDoc<Record<string, unknown>>('changed')).toMatchObject({ value: 'before' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('removed')).toMatchObject({ value: 'before' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('untouched')).toMatchObject({
            value: 'independent',
        });

        automergeRepository.restoreSnapshot(after);
        expect(automergeRepository.getDocIds().sort()).toEqual(['changed', 'created', 'root', 'untouched']);
        expect(automergeRepository.getDoc<Record<string, unknown>>('changed')).toMatchObject({ value: 'after' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('created')).toMatchObject({ value: 'after' });
        expect(automergeRepository.getDoc<Record<string, unknown>>('untouched')).toMatchObject({
            value: 'independent',
        });
    });

    it('does not partially restore membership when any present entry is corrupt', () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('changed');
        automergeRepository.changeDoc('changed', (doc: Record<string, unknown>) => {
            doc.value = 'before';
        });
        let replacement = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
        replacement = change(replacement, (doc) => {
            doc.value = 'after';
        });
        const snapshot: TestDocumentSnapshot = new Map([
            ['changed', { state: 'present', bytes: save(replacement) }],
            ['created', { state: 'present', bytes: new Uint8Array([1, 2, 3]) }],
        ]);

        expect(() => automergeRepository.restoreSnapshot(snapshot)).toThrow();

        expect(automergeRepository.getDoc<Record<string, unknown>>('changed')).toMatchObject({ value: 'before' });
        expect(automergeRepository.hasDoc('created')).toBe(false);
    });
});

describe('transactSnapshot - serialised transactions', () => {
    it('does not interleave dirtied sets between two racing transactions', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('doc-1');
        automergeRepository.createChildDoc('doc-2');

        // Each transaction yields to a microtask between its two writes. Fired
        // without awaiting, their bodies interleave: A-write, B-write, A-write,
        // B-write. Without a serial queue the two share `activeTransaction`, so
        // each call's dirtied set picks up the *other* call's doc. The queue
        // must run them one-at-a-time so each set stays disjoint.
        const txnA = automergeRepository.transactSnapshot(async (transaction) => {
            automergeRepository.changeDoc(
                'doc-1',
                (d: Record<string, unknown>) => {
                    d.a1 = 1;
                },
                undefined,
                transaction
            );
            await Promise.resolve();
            automergeRepository.changeDoc(
                'doc-1',
                (d: Record<string, unknown>) => {
                    d.a2 = 1;
                },
                undefined,
                transaction
            );
        });
        const txnB = automergeRepository.transactSnapshot(async (transaction) => {
            automergeRepository.changeDoc(
                'doc-2',
                (d: Record<string, unknown>) => {
                    d.b1 = 1;
                },
                undefined,
                transaction
            );
            await Promise.resolve();
            automergeRepository.changeDoc(
                'doc-2',
                (d: Record<string, unknown>) => {
                    d.b2 = 1;
                },
                undefined,
                transaction
            );
        });

        const [resA, resB] = await Promise.all([txnA, txnB]);

        // Each transaction sees exactly its own doc — not the other's.
        expect([...resA.before.keys()]).toEqual(['doc-1']);
        expect([...resA.after.keys()]).toEqual(['doc-1']);
        expect([...resB.before.keys()]).toEqual(['doc-2']);
        expect([...resB.after.keys()]).toEqual(['doc-2']);
    });

    it('a rejecting transaction does not wedge later transactions', async () => {
        automergeRepository.createProject('p');

        const failing = automergeRepository.transactSnapshot(() => Promise.reject(new Error('boom')));
        await expect(failing).rejects.toThrow('boom');

        // The queue tail must recover so this one still runs.
        const ok = await automergeRepository.transactSnapshot((transaction) => {
            automergeRepository.changeDoc(
                'root',
                (d: Record<string, unknown>) => {
                    d.ok = true;
                },
                undefined,
                transaction
            );
            return Promise.resolve();
        });
        expect([...ok.after.keys()]).toEqual(['root']);
    });
});

describe('mergeBundle sync fallback — byte-equivalence with the worker path (fix 4: misdiagnosed)', () => {
    // The original bug report claimed the sync fallback's bare merge(local,
    // incoming) leaves a different change graph than the worker path's
    // save()-compacted merge, making getChanges non-deterministic. Empirically
    // (Automerge v3) merge() already returns a canonical doc: when both paths
    // operate on the *same* local doc state, their outputs are byte-identical
    // and getChanges agrees. These tests pin that property so the bare merge is
    // not "fixed" with a redundant load(save()) round-trip — and would catch a
    // future Automerge that stops compacting on merge.
    it('save(merge(local, incoming)) is already canonical (re-serialisation is a no-op)', () => {
        // Fixed actor ids → fully deterministic, controlled comparison.
        let local = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
        local = change(local, (d) => {
            d.a = 1;
        });
        local = change(local, (d) => {
            d.b = 2;
        });
        let remote = init<Record<string, unknown>>('bbbbbbbbbbbbbbbb');
        remote = change(remote, (d) => {
            d.a = 1;
        });
        remote = change(remote, (d) => {
            d.c = 3;
        });

        const merged = merge(load(save(local)), load(save(remote)));
        const direct = save(merged);
        const reSerialised = save(load(direct));
        expect(Buffer.compare(Buffer.from(direct), Buffer.from(reSerialised))).toBe(0);
    });

    /**
     * Builds one canonical local seed and reuses its bytes for both the
     * worker-style reference merge and the repository's real sync-fallback
     * merge, then returns both outputs for comparison.
     *
     * `change()` stamps its implicit `time` with `Date.now()`. This used to
     * build the local seed via two *independent* `init(ACTOR_LOCAL)` calls -
     * one per path - so the two paths' change hashes (and therefore their
     * merged bytes) only agreed when both builds landed in the same
     * wall-clock second. That is the same actor-id hazard fixed for
     * `seedAmDoc()` in `automergeSync.spec.ts` (#1255): two independent
     * documents sharing an explicit actor id, each accumulating its own
     * changes, compared as if they had to be byte-identical. Building the
     * seed once and reusing its bytes removes the timing dependency; see the
     * regression guard below.
     */
    async function runLocalRemoteMergeComparison(): Promise<{ mergedBytes: Uint8Array; referenceBytes: Uint8Array }> {
        const ACTOR_LOCAL = 'aaaaaaaaaaaaaaaa';
        const ACTOR_REMOTE = 'bbbbbbbbbbbbbbbb';
        let localSeed = init<Record<string, unknown>>(ACTOR_LOCAL);
        localSeed = change(localSeed, (x) => {
            x.a = 1;
        });
        localSeed = change(localSeed, (x) => {
            x.b = 2;
        });
        const localBytes = save(localSeed);

        let remote = init<Record<string, unknown>>(ACTOR_REMOTE);
        remote = change(remote, (d) => {
            d.a = 1;
        });
        remote = change(remote, (d) => {
            d.c = 3;
        });
        const remoteBytes = save(remote);

        // Worker-style reference: round-trip local (saveAll), merge, save.
        const referenceMerged = load(save(merge(load(localBytes), load(remoteBytes))));
        const referenceBytes = save(referenceMerged);

        // Drive the real sync fallback: seed the same local state, Worker stub
        // throws → mergeBundle falls back to _mergeBundleSync.
        automergeRepository.createProject('p');
        automergeRepository.insertDoc('root', load(localBytes));
        const result = await automergeRepository.mergeBundle(new Map([['root', remoteBytes]]));
        expect(result.mergedDocIds).toEqual(['root']);

        const mergedBytes = automergeRepository.saveDoc('root')!;
        return { mergedBytes, referenceBytes };
    }

    it('sync fallback yields the same bytes/getChanges/heads as the worker-style compacted merge for the same local state', async () => {
        const { mergedBytes, referenceBytes } = await runLocalRemoteMergeComparison();
        expect(Buffer.compare(Buffer.from(mergedBytes), Buffer.from(referenceBytes))).toBe(0);

        const mergedDoc = load(mergedBytes);
        const referenceMerged = load(referenceBytes);
        const refCount = getChanges(view(referenceMerged, []), referenceMerged).length;
        const gotCount = getChanges(view(mergedDoc, []), mergedDoc).length;
        expect(gotCount).toBe(refCount);
        expect(getHeads(mergedDoc)).toEqual(getHeads(referenceMerged));
    });

    it('stays deterministic when the wall clock advances between the reference merge and the repository merge', async () => {
        // Regression guard for the actor-id hazard documented on
        // `runLocalRemoteMergeComparison`: force every subsequent Automerge
        // `change()` in this test onto a new wall-clock second. Before the
        // fix, the local seed was built twice (once per path) and this
        // reliably desynced their change hashes, failing the byte comparison
        // below; with the fix (one canonical build, reused bytes) the clock
        // moving elsewhere in the test cannot affect it.
        const now_spy = vi.spyOn(Date, 'now');
        let tick = 1_700_000_000_000;
        now_spy.mockImplementation(() => {
            tick += 1_000;
            return tick;
        });
        try {
            const { mergedBytes, referenceBytes } = await runLocalRemoteMergeComparison();
            expect(Buffer.compare(Buffer.from(mergedBytes), Buffer.from(referenceBytes))).toBe(0);
        } finally {
            now_spy.mockRestore();
        }
    });

    it('keeps the current repository intact when merge commit authority is revoked', async () => {
        let local = init<Record<string, unknown>>('aaaaaaaaaaaaaaaa');
        local = change(local, (doc) => {
            doc.localOnly = true;
        });
        let remote = init<Record<string, unknown>>('bbbbbbbbbbbbbbbb');
        remote = change(remote, (doc) => {
            doc.remoteOnly = true;
        });

        automergeRepository.createProject('current');
        automergeRepository.insertDoc('root', local);
        const currentBytes = automergeRepository.saveDoc('root');

        const result = await automergeRepository.mergeBundle(new Map([['root', save(remote)]]), {
            shouldCommit: () => false,
        });

        expect(result).toEqual({ mergedDocIds: [], newDocIds: [] });
        expect(automergeRepository.saveDoc('root')).toEqual(currentBytes);
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).toMatchObject({ localOnly: true });
        expect(automergeRepository.getDoc<Record<string, unknown>>('root')).not.toHaveProperty('remoteOnly');
    });
});

describe('reset clears change listeners (fix 5)', () => {
    it('does not fire listeners registered before reset on post-reset edits', () => {
        automergeRepository.createProject('p');
        const stale = vi.fn();
        automergeRepository.onChange(stale);

        automergeRepository.reset();
        automergeRepository.createProject('p2');
        automergeRepository.changeDoc('root', (d: Record<string, unknown>) => {
            d.x = 1;
        });

        expect(stale).not.toHaveBeenCalled();
    });
});

describe('root id inference is exact, not prefix (fix 6)', () => {
    it('validates a loadable bundle without replacing the current repository', async () => {
        automergeRepository.createProject('current');
        automergeRepository.createChildDoc('child');
        const bundle = automergeRepository.saveAll();
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.value = 'incremental';
        });
        const incremental = automergeRepository.saveDocIncremental('root');
        if (!incremental) {
            throw new Error('Expected an incremental root chunk');
        }
        bundle.set('root:incremental:10-0', incremental);
        const currentRoot = automergeRepository.getDoc('root');

        await expect(automergeRepository.validateAll({ bundle })).resolves.toBe(true);

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });

    it('selects "root" exactly even when sibling ids start with "root" iterate later', async () => {
        // Bundle whose Map iteration order puts a "rootBackup" sibling *after*
        // the real "root". With startsWith, rootBackup would win.
        automergeRepository.createProject('seed');
        const rootBytes = automergeRepository.saveDoc('root')!;
        automergeRepository.createChildDoc('rootBackup');
        const backupBytes = automergeRepository.saveDoc('rootBackup')!;

        automergeRepository.reset();

        const bundle = new Map([
            ['root', rootBytes],
            ['rootBackup', backupBytes],
        ]);
        // Worker stub throws → _loadAllSync runs the inference under test.
        await automergeRepository.loadAll({ bundle });

        expect(automergeRepository.getRootId()).toBe('root');
    });

    it('keeps the current repository intact when commit authority is revoked', async () => {
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');
        const bundle = automergeRepository.saveAll();

        const committed = await automergeRepository.loadAll({
            bundle,
            shouldCommit: () => false,
        });

        expect(committed).toBe(false);
        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });

    it('treats only an empty bundle as absence', async () => {
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');

        await expect(automergeRepository.validateAll({ bundle: new Map() })).resolves.toBe(false);
        await expect(automergeRepository.loadAll({ bundle: new Map() })).resolves.toBe(false);

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });

    it('rejects a non-empty bundle without the exact authoritative root document', async () => {
        automergeRepository.createProject('source');
        automergeRepository.createChildDoc('branch-only');
        const branchBytes = automergeRepository.saveDoc('branch-only')!;

        automergeRepository.reset();
        automergeRepository.createProject('current');
        automergeRepository.createChildDoc('current-child');
        const currentRoot = automergeRepository.getDoc('root');
        const currentChild = automergeRepository.getDoc('current-child');
        const bundle = new Map([['branch-only', branchBytes]]);

        await expect(automergeRepository.validateAll({ bundle })).rejects.toThrow('missing the exact root document');
        await expect(automergeRepository.loadAll({ bundle })).rejects.toThrow('missing the exact root document');

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
        expect(automergeRepository.getDoc('current-child')).toBe(currentChild);
    });

    it('does not count root-prefixed siblings or root incrementals as the root', async () => {
        automergeRepository.createProject('source');
        automergeRepository.createChildDoc('rootBackup');
        const backupBytes = automergeRepository.saveDoc('rootBackup')!;

        automergeRepository.reset();
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');

        await expect(
            automergeRepository.loadAll({
                bundle: new Map([
                    ['rootBackup', backupBytes],
                    ['root:incremental:10-0', new Uint8Array([1, 2, 3])],
                ]),
            })
        ).rejects.toThrow('missing base document');

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });

    it('returns false instead of classifying corruption when commit authority is revoked', async () => {
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');

        await expect(
            automergeRepository.loadAll({
                bundle: new Map([['root', new Uint8Array([1, 2, 3])]]),
                shouldCommit: () => false,
            })
        ).resolves.toBe(false);

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });

    it('propagates corrupt persisted bytes during presence validation', async () => {
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');

        await expect(
            automergeRepository.validateAll({
                bundle: new Map([['root', new Uint8Array([1, 2, 3])]]),
            })
        ).rejects.toThrow();

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });

    it('rejects orphan incrementals in the synchronous fallback without replacing authority', async () => {
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');
        const rootBytes = automergeRepository.saveDoc('root');
        if (!rootBytes) {
            throw new Error('Expected a persisted root document');
        }

        const bundle = new Map([
            ['root', rootBytes],
            ['orphan-child:incremental:1-0', new Uint8Array([1, 2, 3])],
        ]);

        await expect(automergeRepository.loadAll({ bundle })).rejects.toThrow('missing base document');

        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
        expect(automergeRepository.getRootId()).toBe('root');
    });

    it('does not let a worker integrity error fall back to acceptance', async () => {
        class IntegrityErrorWorker {
            private messageListener: EventListener | null = null;

            addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
                if (type === 'message' && typeof listener === 'function') {
                    this.messageListener = listener;
                }
            }

            removeEventListener(): void {
                this.messageListener = null;
            }

            postMessage(message: Record<string, unknown>): void {
                this.messageListener?.(
                    new MessageEvent('message', {
                        data: { id: message.id, type: 'error', message: 'orphan incremental integrity failure' },
                    })
                );
            }
        }

        vi.stubGlobal('Worker', IntegrityErrorWorker);
        automergeRepository.createProject('current');
        const currentRoot = automergeRepository.getDoc('root');
        const rootBytes = automergeRepository.saveDoc('root');
        if (!rootBytes) {
            throw new Error('Expected a persisted root document');
        }

        const bundle = new Map([
            ['root', rootBytes],
            ['orphan-child:incremental:1-0', new Uint8Array([1, 2, 3])],
        ]);

        await expect(automergeRepository.loadAll({ bundle })).rejects.toThrow('missing base document');
        expect(automergeRepository.getDoc('root')).toBe(currentRoot);
    });
});
