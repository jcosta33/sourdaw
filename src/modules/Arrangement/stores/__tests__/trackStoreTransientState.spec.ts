import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    countPendingAutomergeStorageWrites,
    flushAutomergeStorageWrites,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';

import { ClipDummy } from '../../__tests__/ClipDummy';
import { TrackDummy } from '../../__tests__/TrackDummy';
import { setArrangementEventBus } from '../../useCases/arrangementEventBus';
import { selectTrack } from '../../useCases/toggleTrackState/selectTrack';
import { defaultTrackState, trackStore, type TrackStoreState } from '../trackStore';

type TestDoc = {
    [key: string]: unknown;
};

type TestPort = NonNullable<Parameters<typeof configureAutomergeStoragePort>[0]>;

const fake_doc: TestDoc = {};

function clear_fake_doc(): void {
    for (const key of Object.keys(fake_doc)) {
        delete fake_doc[key];
    }
}

function configure_fake_crdt_port(): void {
    const port: TestPort = {
        getDoc: () => fake_doc,
        getSemanticMessage: () => undefined,
        hasDoc: () => true,
        mutateDoc: ({ changeFn }) => {
            changeFn(fake_doc);
        },
    };

    configureAutomergeStoragePort(port);
}

async function flush_pending_frame(): Promise<void> {
    await new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
            resolve();
        });
    });
}

async function reset_store_and_doc(): Promise<void> {
    configureAutomergeStoragePort(null);
    trackStore.set(structuredClone(defaultTrackState));
    await flush_pending_frame();
    clear_fake_doc();
    configure_fake_crdt_port();
}

/**
 * Transient-state integrity. Durable project truth is `tracks`; `selectedTrackId`
 * and `ghostClips` are ephemeral (UI selection + AI scratch clips) that must NOT be
 * re-derived from the CRDT — they are carried over from the live in-memory store.
 * `get_valid_transient_state` guards that carry-over: a corrupted live store
 * (an untrusted shape that reached `.value`) must fall back to safe defaults
 * instead of propagating garbage into project truth.
 *
 * Each test hydrates a DISTINCT durable payload (unique track id) so the storage
 * adapter's hydrate-dedup (§119.2) actually runs fromCrdt rather than skipping.
 */
describe('trackStore transient-state fallback', () => {
    beforeEach(async () => {
        await reset_store_and_doc();
    });

    afterEach(() => {
        configureAutomergeStoragePort(null);
    });

    it('drops a non-string/non-null live selectedTrackId back to null on hydration', () => {
        // A number reaching selectedTrackId is never a valid UI selection. Domain
        // intent: never surface a non-string id as project truth.
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-live', name: 'Live' })],
            selectedTrackId: 42 as unknown as string,
            ghostClips: [],
        });
        fake_doc.tracks = { tracks: [{ id: 'probe-selection', kind: 'audio', name: 'Probe' }] };

        trackStore.hydrate();

        // The selection resets to null; durable tracks came from the CRDT.
        expect(trackStore.value?.selectedTrackId).toBeNull();
        expect(trackStore.value?.tracks).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.id).toBe('probe-selection');
    });

    it('drops a non-array live ghostClips back to an empty array on hydration', () => {
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-live', name: 'Live' })],
            selectedTrackId: 'track-live',
            ghostClips: 'not-an-array' as unknown as TrackStoreState['ghostClips'],
        });
        fake_doc.tracks = { tracks: [{ id: 'probe-ghost', kind: 'audio', name: 'Probe' }] };

        trackStore.hydrate();

        // ghostClips must never be a non-array in project truth.
        expect(Array.isArray(trackStore.value?.ghostClips)).toBe(true);
        expect(trackStore.value?.ghostClips).toEqual([]);
        // The transient guard is all-or-nothing: a corrupted ghostClips voids
        // the entire transient payload, so the otherwise-valid selection also
        // resets to null rather than half-carrying a partially-valid state.
        expect(trackStore.value?.selectedTrackId).toBeNull();
    });

    it('still carries a valid live transient state forward when not corrupted', () => {
        const valid_ghost = {
            id: 'ghost-1',
            trackId: 'track-1',
            name: 'Ghost',
            startBeat: 0,
            endBeat: 2,
            type: 'audio' as const,
            fadeInBeats: 0,
            fadeOutBeats: 0,
            gain: 1,
            color: '',
            locked: false,
            muted: false,
        };
        trackStore.set({
            tracks: [TrackDummy.create({ id: 'track-cached', name: 'Cached' })],
            selectedTrackId: 'probe-valid',
            ghostClips: [valid_ghost],
        });
        fake_doc.tracks = { tracks: [{ id: 'probe-valid', kind: 'audio', name: 'Probe' }] };

        trackStore.hydrate();

        // Valid live transients survive; only durable truth came from the CRDT.
        // `selectedTrackId` must reference a track that actually exists in the
        // post-hydration snapshot — this was previously carried over blind
        // (finding: a dangling `selectedTrackId` survives CRDT hydration even
        // after the track it names is gone), so the fixture here selects the
        // track that is genuinely present after hydration rather than an id
        // that exists in neither the live nor the hydrated track list.
        expect(trackStore.value?.selectedTrackId).toBe('probe-valid');
        expect(trackStore.value?.ghostClips).toEqual([valid_ghost]);
    });

    it('notifies once for each public selection and same-array local update without claiming document authority', () => {
        const track = TrackDummy.create({ id: 'track-local', name: 'Local', kind: 'audio' });
        trackStore.set({ tracks: [track], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        setArrangementEventBus({ emit: () => Promise.resolve() });
        const raw = structuredClone(fake_doc);
        const tracks = trackStore.value!.tracks;
        const pending = countPendingAutomergeStorageWrites();
        const storeObserver = vi.fn();
        const reactObserver = vi.fn();
        const unsubscribe = trackStore.subscribe(storeObserver);
        const unsubscribeReact = trackStore.subscribeReact(reactObserver);
        try {
            selectTrack(track.id);
            expect(trackStore.value?.selectedTrackId).toBe(track.id);
            expect(trackStore.value?.tracks).toBe(tracks);
            expect(storeObserver).toHaveBeenCalledTimes(1);
            expect(reactObserver).toHaveBeenCalledTimes(1);
            expect(countPendingAutomergeStorageWrites()).toBe(pending);
            expect(fake_doc).toEqual(raw);

            const ghost = ClipDummy.create({ id: 'local-ghost', trackId: track.id });
            trackStore.update((current) => ({ ...current!, ghostClips: [ghost] }));
            expect(trackStore.value?.ghostClips).toEqual([ghost]);
            expect(storeObserver).toHaveBeenCalledTimes(2);
            expect(reactObserver).toHaveBeenCalledTimes(2);
            expect(countPendingAutomergeStorageWrites()).toBe(pending);
            expect(fake_doc).toEqual(raw);

            selectTrack(track.id);
            expect(storeObserver).toHaveBeenCalledTimes(3);
            expect(reactObserver).toHaveBeenCalledTimes(3);
            selectTrack('missing-track');
            expect(trackStore.value?.selectedTrackId).toBeNull();
            expect(storeObserver).toHaveBeenCalledTimes(4);
            expect(reactObserver).toHaveBeenCalledTimes(4);
            expect(trackStore.trySet({ ...trackStore.value!, selectedTrackId: track.id })).toBe(false);
            expect(trackStore.value?.selectedTrackId).toBe(track.id);
            expect(storeObserver).toHaveBeenCalledTimes(5);
            expect(reactObserver).toHaveBeenCalledTimes(5);
            expect(countPendingAutomergeStorageWrites()).toBe(pending);
            expect(fake_doc).toEqual(raw);
        } finally {
            unsubscribe();
            unsubscribeReact();
        }
    });

    it('retains local selection and ghosts after an unrelated pending tracks owner aborts', () => {
        const base = TrackDummy.create({ id: 'track-base', name: 'Base', kind: 'audio' });
        const peer = TrackDummy.create({ id: 'track-peer', name: 'Peer', kind: 'audio' });
        trackStore.set({ tracks: [base], selectedTrackId: null, ghostClips: [] });
        flushAutomergeStorageWrites();
        const raw = structuredClone(fake_doc);
        const foreign = runWithAutomergeStorageTransaction(undefined, () => {
            trackStore.set({ ...trackStore.value!, tracks: [base, peer] });
        });
        expect(foreign.status).toBe('returned');
        const pending = countPendingAutomergeStorageWrites();
        const ghost = ClipDummy.create({ id: 'abort-local-ghost', trackId: base.id });
        const observer = vi.fn();
        const reactObserver = vi.fn();
        const unsubscribe = trackStore.subscribe(observer);
        const unsubscribeReact = trackStore.subscribeReact(reactObserver);
        try {
            trackStore.set({ ...trackStore.value!, selectedTrackId: base.id, ghostClips: [ghost] });
            expect(observer).toHaveBeenCalledTimes(1);
            expect(reactObserver).toHaveBeenCalledTimes(1);
            expect(countPendingAutomergeStorageWrites()).toBe(pending);
            foreign.abort();
            expect(observer).toHaveBeenCalledTimes(2);
            expect(reactObserver).toHaveBeenCalledTimes(2);
            expect(trackStore.value?.tracks).toEqual([base]);
            expect(trackStore.value?.selectedTrackId).toBe(base.id);
            expect(trackStore.value?.ghostClips).toEqual([ghost]);
            expect(fake_doc).toEqual(raw);
        } finally {
            unsubscribe();
            unsubscribeReact();
        }
    });

    it.each(['selection', 'ghosts'] as const)(
        'keeps an independent %s edit without retaining the aborted owner’s other transient fields',
        (field) => {
            const selected = TrackDummy.create({ id: 'selected', name: 'Selected', kind: 'audio' });
            const survivor = TrackDummy.create({ id: 'survivor', name: 'Survivor', kind: 'audio' });
            const originalGhost = ClipDummy.create({ id: 'original-ghost', trackId: selected.id });
            trackStore.set({ tracks: [selected, survivor], selectedTrackId: selected.id, ghostClips: [originalGhost] });
            flushAutomergeStorageWrites();
            const committedTracks = trackStore.value!.tracks;
            const raw = structuredClone(fake_doc);
            const pending = runWithAutomergeStorageTransaction(undefined, () => {
                trackStore.set({ tracks: [survivor], selectedTrackId: null, ghostClips: [] });
            });
            expect(pending.status).toBe('returned');
            const pendingCount = countPendingAutomergeStorageWrites();
            const localGhost = ClipDummy.create({ id: 'independent-ghost', trackId: survivor.id });

            if (field === 'selection') {
                trackStore.set({ ...trackStore.value!, selectedTrackId: survivor.id });
            } else {
                trackStore.set({ ...trackStore.value!, ghostClips: [localGhost] });
            }

            expect(countPendingAutomergeStorageWrites()).toBe(pendingCount);
            pending.abort();
            expect(trackStore.value?.tracks).toBe(committedTracks);
            expect(trackStore.value?.selectedTrackId).toBe(field === 'selection' ? survivor.id : selected.id);
            expect(trackStore.value?.ghostClips).toEqual(field === 'ghosts' ? [localGhost] : [originalGhost]);
            expect(fake_doc).toEqual(raw);
        }
    );
});
