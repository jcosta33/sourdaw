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

function createTestPort(initialDoc: TestDoc): { doc: TestDoc; port: TestPort } {
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
    return { doc, port };
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
});
