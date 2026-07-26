import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createStore } from '../createStore';
import {
    configureAutomergeStoragePort,
    createAutomergeStorage,
    flushAutomergeStorageWrites,
} from '../storage/createAutomergeStorage';
import { createMemoryStorage } from '../storage/createMemoryStorage';

/**
 * A sanitizer is a READ-side guard, not an authority over shared truth.
 *
 * Row validators in this codebase are structural and version-blind, and no
 * protocol version is negotiated anywhere in the sync layer. So a peer running
 * a build whose validator still requires a field a newer build has removed
 * rejects every row that lacks it. Rejecting is correct — an unreadable row
 * must not reach downstream readers. Writing the rejection back into the
 * shared document is not: it deletes, for every peer, rows that a peer on
 * another build reads perfectly well.
 *
 * The same argument covers genuinely corrupt data. Unilaterally rewriting a
 * shared document from one replica's opinion fights the CRDT: refusing to
 * display a bad row costs nothing and converges, broadcasting a repair does
 * not.
 *
 * `hydrate()` already honours this for the absent-slot case — see the
 * projection-purity note in createAutomergeStorage. Sanitization was the same
 * mistake in a second place.
 */

type LaneRow = { id: string; value: number; legacy?: string };
type LaneState = { lanes: LaneRow[] };
type TestDoc = { [key: string]: unknown };
type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

function createTestPort(initialDoc: TestDoc): {
    doc: TestDoc;
    port: TestPort;
    /** Model a remote change landing: the slot moved without this replica writing it. */
    bumpHeads: () => void;
} {
    const doc = initialDoc;
    let headsCounter = 0;
    const port: TestPort = {
        getDoc: () => doc,
        getDocHeads: () => [`head-${headsCounter}`],
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(doc);
            headsCounter += 1;
        },
    };
    return {
        doc,
        port,
        bumpHeads: () => {
            headsCounter += 1;
        },
    };
}

function isLaneRow(value: unknown): value is LaneRow {
    return (
        typeof value === 'object' &&
        value !== null &&
        typeof (value as LaneRow).id === 'string' &&
        typeof (value as LaneRow).value === 'number'
    );
}

/** The build that removed `legacy`: it no longer requires the field. */
function sanitizeAsCurrentBuild(value: unknown): LaneState {
    const lanes = (value as LaneState | null)?.lanes;
    if (!Array.isArray(lanes)) {
        return { lanes: [] };
    }
    return { lanes: lanes.filter(isLaneRow).map((lane) => ({ id: lane.id, value: lane.value })) };
}

/** The older build: its validator still requires `legacy`, so rows written by
 *  the newer build fail every one of them. */
function sanitizeAsOlderBuild(value: unknown): LaneState {
    const lanes = (value as LaneState | null)?.lanes;
    if (!Array.isArray(lanes)) {
        return { lanes: [] };
    }
    const accepted = lanes.filter((lane): lane is LaneRow => isLaneRow(lane) && typeof lane.legacy === 'string');
    return { lanes: accepted.map((lane) => ({ id: lane.id, value: lane.value, legacy: lane.legacy })) };
}

describe('createStore sanitization against a shared document', () => {
    beforeEach(() => {
        vi.stubGlobal(
            'requestAnimationFrame',
            vi.fn(() => 1)
        );
        vi.stubGlobal(
            'cancelAnimationFrame',
            vi.fn(() => undefined)
        );
        configureAutomergeStoragePort(null);
    });

    afterEach(() => {
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        vi.unstubAllGlobals();
    });

    it('lets a peer whose validator rejects a row keep it readable for a peer that accepts it', () => {
        const { doc, port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);

        // The peer on the older build projects the shared slot. Its validator
        // requires `legacy`, so the row fails.
        const olderPeerStore = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsOlderBuild,
        });
        olderPeerStore.hydrate();
        flushAutomergeStorageWrites();

        // Rejecting is correct: the older peer must not surface a row it
        // cannot read.
        expect(olderPeerStore.value).toEqual({ lanes: [] });

        // Destroying it for everyone is not. The row is still in the document.
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });

        // And a peer on the current build still reads it.
        const currentPeerStore = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsCurrentBuild,
        });
        currentPeerStore.hydrate();

        expect(currentPeerStore.value).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
    });

    it('keeps a field the local build does not know rather than stripping it from the document', () => {
        // The reverse direction: a row carrying a field this build has never
        // heard of. The rebuild strips it for the local read view, which is
        // fine — writing the stripped row back deletes the field for the peer
        // that authored it, which is the same loss at field granularity.
        const { doc, port } = createTestPort({
            lanes: { lanes: [{ id: 'lane-1', value: 7, unknownFutureField: 'from-newer-build' }] },
        });
        configureAutomergeStoragePort(port);

        const store = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsCurrentBuild,
        });
        store.hydrate();
        flushAutomergeStorageWrites();

        expect(store.value).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-1', value: 7, unknownFutureField: 'from-newer-build' }] });
    });

    it('still repairs backing storage that no peer can see', () => {
        // Local-only storage has no peer to lose and repair is the whole
        // point, so the write-back must survive there.
        const storage = createMemoryStorage<LaneState>();
        storage.set({ lanes: [{ id: 'lane-1', value: 7 }, 'corrupt' as unknown as LaneRow] });

        const store = createStore<LaneState>({
            storage,
            sanitize: sanitizeAsCurrentBuild,
        });

        expect(store.value).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
        expect(storage.get()).toEqual({ lanes: [{ id: 'lane-1', value: 7 }] });
    });

    it('reports the store slot whose content a sanitizer withheld from readers', () => {
        const { port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);
        const warn = vi.fn();
        const logger = { debug: vi.fn(), info: vi.fn(), warn, error: vi.fn(), setWriters: vi.fn() };

        const store = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsOlderBuild,
            logger,
        });
        store.hydrate();

        expect(warn).toHaveBeenCalledTimes(1);
        expect(String(warn.mock.calls[0]?.[0])).toContain('quarantined');
    });

    it('delivers a local edit that was in flight while a sanitizer quarantined content', () => {
        // Quarantining is a read-side act, so it must not look like a commit to
        // an unflushed local write. The supersede guard abandons an unscoped
        // pending whose revision predates the newest committed value; if
        // quarantining advances that high-water mark, the guard fires with no
        // commit behind it and the user's edit is dropped on the floor while
        // `store.value` still shows it.
        const { doc, port } = createTestPort({ lanes: { lanes: [{ id: 'lane-1', value: 7 }] } });
        configureAutomergeStoragePort(port);
        const store = createStore<LaneState>({
            storage: createAutomergeStorage<LaneState>('root', 'lanes'),
            sanitize: sanitizeAsOlderBuild,
        });

        // A local edit the user has authored but whose rAF has not fired.
        store.set({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });
        // A sync message lands and is projected, quarantining lane-1.
        store.hydrate();
        flushAutomergeStorageWrites();

        expect(store.value).toEqual({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });
        // What the store shows must be what the document received.
        expect(doc.lanes).toEqual({ lanes: [{ id: 'lane-2', value: 2, legacy: 'kept' }] });
    });

    it('does not let a pending write the hydrate just rebased outrank the sanitizer', () => {
        // `toCrdt` strips a field on its way to the document — the documented
        // reason the option exists — so the slot legitimately carries fewer
        // keys than the store's own value. To stop a hydrate discarding the
        // stripped fields, the rebase re-supplies them from the pending write:
        // `{ ...pendingValue, ...crdtData }`. That blend is neither what the
        // user authored nor what the document holds, and it can be a
        // combination that is invalid while both halves are valid alone.
        //
        // The sanitizer sees the blend and rejects it. Its verdict then has to
        // survive: the pending write is a real armed rAF write, and `sanitize`
        // is never consulted on the commit path, so a rejected blend that
        // stays in the pending reaches the shared document unexamined.
        type PunchState = { punchInBeat: number; punchOutBeat: number };

        const stripPunchIn = (value: PunchState): PunchState => {
            const { punchInBeat: _ephemeral, ...persisted } = value;
            return persisted as PunchState;
        };
        const sanitizePunch = (value: unknown): PunchState => {
            const record = value as Partial<PunchState> | null;
            const punchInBeat = typeof record?.punchInBeat === 'number' ? record.punchInBeat : 0;
            const punchOutBeat = typeof record?.punchOutBeat === 'number' ? record.punchOutBeat : 1;
            if (punchOutBeat <= punchInBeat) {
                return { punchInBeat: 0, punchOutBeat: 1 };
            }
            return { punchInBeat, punchOutBeat };
        };

        const { doc, port, bumpHeads } = createTestPort({ punch: { punchOutBeat: 4 } });
        configureAutomergeStoragePort(port);
        const store = createStore<PunchState>({
            storage: createAutomergeStorage<PunchState>('root', 'punch', { toCrdt: stripPunchIn }),
            sanitize: sanitizePunch,
        });

        // Authored locally, still in flight. Valid: 8 < 10.
        store.set({ punchInBeat: 8, punchOutBeat: 10 });
        // A remote change lands. Valid: the absent punch-in reads as 0 < 5.
        doc.punch = { punchOutBeat: 5 };
        bumpHeads();
        // The rebase blends them into { punchInBeat: 8, punchOutBeat: 5 } — a
        // punch region that ends before it starts.
        store.hydrate();
        flushAutomergeStorageWrites();

        expect(store.value).toEqual({ punchInBeat: 0, punchOutBeat: 1 });
        // The armed write must not carry the combination the sanitizer refused.
        expect(doc.punch).toEqual({ punchOutBeat: 1 });
    });
});
