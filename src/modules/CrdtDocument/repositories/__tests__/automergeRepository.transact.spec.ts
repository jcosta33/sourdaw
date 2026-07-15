/**
 * Integration regression tests for AutomergeRepository's snapshot/merge/reset
 * paths, run against *real* Automerge (no `vi.mock('@automerge/automerge')`),
 * because the bugs under test are about the actual binary change graph and the
 * rAF-deferred write ordering — both of which a mock would paper over.
 */
import { init, change, load, save, merge, getChanges, getHeads, view } from '@automerge/automerge';
import { describe, it, expect, beforeEach, vi } from 'vitest';

import { automergeRepository } from '../automergeRepository';

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

describe('transactSnapshot — rAF-deferred store writes (fix 1) + lazy before-clone (fix 2)', () => {
    it('captures the before/after bundle for a doc mutated through a requestAnimationFrame-deferred write', async () => {
        automergeRepository.createProject('p');
        // Seed a known "before" value on root.
        automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
            doc.count = 1;
        });

        const { before, after } = await automergeRepository.transactSnapshot(() => {
            // Simulate createAutomergeStorage.set(): defer the actual changeDoc
            // to the next animation frame. transactSnapshot must drain this
            // before reading the dirtied set, or the bundle is empty.
            requestAnimationFrame(() => {
                automergeRepository.changeDoc('root', (doc: Record<string, unknown>) => {
                    doc.count = 2;
                });
            });
            // fn() resolves immediately — the rAF write has NOT landed yet.
            return Promise.resolve();
        });

        // dirtied must have captured root despite the deferral.
        expect(before.has('root')).toBe(true);
        expect(after.has('root')).toBe(true);

        const beforeDoc = load<Record<string, unknown>>(before.get('root')!);
        const afterDoc = load<Record<string, unknown>>(after.get('root')!);
        // Pre-state is the genuine pre-mutation value (1), not the post (2).
        expect(beforeDoc.count).toBe(1);
        expect(afterDoc.count).toBe(2);
    });

    it('does not clone undirtied docs into the before bundle', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('child-a');
        automergeRepository.createChildDoc('child-b');

        const { before, after } = await automergeRepository.transactSnapshot(() => {
            automergeRepository.changeDoc('child-a', (doc: Record<string, unknown>) => {
                doc.touched = true;
            });
            return Promise.resolve();
        });

        expect([...before.keys()]).toEqual(['child-a']);
        expect([...after.keys()]).toEqual(['child-a']);
    });
});

describe('transactSnapshot — serialised transactions (fix 3)', () => {
    it('does not interleave dirtied sets between two racing transactions', async () => {
        automergeRepository.createProject('p');
        automergeRepository.createChildDoc('doc-1');
        automergeRepository.createChildDoc('doc-2');

        // Each transaction yields to a microtask between its two writes. Fired
        // without awaiting, their bodies interleave: A-write, B-write, A-write,
        // B-write. Without a serial queue the two share `activeTransaction`, so
        // each call's dirtied set picks up the *other* call's doc. The queue
        // must run them one-at-a-time so each set stays disjoint.
        const txnA = automergeRepository.transactSnapshot(async () => {
            automergeRepository.changeDoc('doc-1', (d: Record<string, unknown>) => {
                d.a1 = 1;
            });
            await Promise.resolve();
            automergeRepository.changeDoc('doc-1', (d: Record<string, unknown>) => {
                d.a2 = 1;
            });
        });
        const txnB = automergeRepository.transactSnapshot(async () => {
            automergeRepository.changeDoc('doc-2', (d: Record<string, unknown>) => {
                d.b1 = 1;
            });
            await Promise.resolve();
            automergeRepository.changeDoc('doc-2', (d: Record<string, unknown>) => {
                d.b2 = 1;
            });
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
        const ok = await automergeRepository.transactSnapshot(() => {
            automergeRepository.changeDoc('root', (d: Record<string, unknown>) => {
                d.ok = true;
            });
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

    it('sync fallback yields the same bytes/getChanges/heads as the worker-style compacted merge for the same local state', async () => {
        const ACTOR_LOCAL = 'aaaaaaaaaaaaaaaa';
        const ACTOR_REMOTE = 'bbbbbbbbbbbbbbbb';
        function buildLocal(): ReturnType<typeof init<Record<string, unknown>>> {
            let d = init<Record<string, unknown>>(ACTOR_LOCAL);
            d = change(d, (x) => {
                x.a = 1;
            });
            d = change(d, (x) => {
                x.b = 2;
            });
            return d;
        }
        let remote = init<Record<string, unknown>>(ACTOR_REMOTE);
        remote = change(remote, (d) => {
            d.a = 1;
        });
        remote = change(remote, (d) => {
            d.c = 3;
        });
        const remoteBytes = save(remote);

        // Worker-style reference: round-trip local (saveAll), merge, save.
        const referenceMerged = load(save(merge(load(save(buildLocal())), load(remoteBytes))));
        const referenceBytes = save(referenceMerged);

        // Drive the real sync fallback: seed the same local state, Worker stub
        // throws → mergeBundle falls back to _mergeBundleSync.
        automergeRepository.createProject('p');
        automergeRepository.insertDoc('root', buildLocal());
        const result = await automergeRepository.mergeBundle(new Map([['root', remoteBytes]]));
        expect(result.mergedDocIds).toEqual(['root']);

        const mergedBytes = automergeRepository.saveDoc('root')!;
        expect(Buffer.compare(Buffer.from(mergedBytes), Buffer.from(referenceBytes))).toBe(0);

        const mergedDoc = load(mergedBytes);
        const refCount = getChanges(view(referenceMerged, []), referenceMerged).length;
        const gotCount = getChanges(view(mergedDoc, []), mergedDoc).length;
        expect(gotCount).toBe(refCount);
        expect(getHeads(mergedDoc)).toEqual(getHeads(referenceMerged));
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
