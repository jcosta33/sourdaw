import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { takeLaneStore, trackStore, setWarpState, warpStates } from '#/modules/Arrangement/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, readTempoAtBeat, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { createTake, createTakeLane, type TakeLane } from '../../../models/TakeLane';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { resolveClipsWithComping } from '../../../useCases/resolveComping';
import { splitClipWithUndo } from '../splitClipWithUndo';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

function rightClipId(): string {
    const clip = trackStore.value?.tracks[0]?.clips.find((candidate) => candidate.id !== 'clip-1');
    if (!clip) {
        throw new Error('expected the split to create a right clip');
    }
    return clip.id;
}

function lane(): TakeLane {
    const current = takeLaneStore.value?.lanes[0];
    if (!current) {
        throw new Error('expected the comp lane');
    }
    return current;
}

/** One comped take spanning the whole clip, so the split crosses its seam. */
function arrangeCompedTake(): TakeLane {
    const take = createTake('clip-1', 'Full take', 0, 8);
    const compedLane: TakeLane = {
        ...createTakeLane('track-1'),
        takes: [take],
        activeCompRegions: [{ startBeat: 0, endBeat: 8, takeId: take.id }],
    };
    takeLaneStore.set({ lanes: [compedLane] });
    flushAutomergeStorageWrites();
    return structuredClone(compedLane);
}

describe('splitClipWithUndo take restore', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('split clip take restore integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [] });
        warpStates.clear();
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 8 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        tempoMapStore.set({ changes: [] });
        warpStates.clear();
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('restores a take recorded on the right half when the split is redone', async () => {
        splitClipWithUndo('clip-1', 4);
        const splitRightClipId = rightClipId();

        // A take lands on the right half without a local undo entry.
        const take = createTake(splitRightClipId, 'Right take', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();

        // The right half's id is generated, so its order against the source's is not
        // a contract: compare both sides sorted rather than pinning one order.
        expect([...(trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)].sort()).toEqual(
            [splitRightClipId, 'clip-1'].sort()
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });

    it('round-trips a comped take crossing the split through the imperative undo and redo', async () => {
        const originalLane = arrangeCompedTake();

        splitClipWithUndo('clip-1', 4);
        const splitRightClipId = rightClipId();

        // The forward split re-keyed the lane: the left fragment keeps the take
        // id, the right fragment mints its own, and the comp region maps onto
        // both fragment takes instead of ending at the left clip's end.
        const leftTake = lane().takes.find((candidate) => candidate.clipId === 'clip-1');
        if (!leftTake) {
            throw new Error('expected the left fragment to keep its take');
        }
        expect([leftTake.id, leftTake.startBeat, leftTake.endBeat]).toEqual([originalLane.takes[0]!.id, 0, 4]);
        const mintedTake = lane().takes.find((candidate) => candidate.clipId === splitRightClipId);
        if (!mintedTake) {
            throw new Error('expected the right fragment to mint its take');
        }
        expect([mintedTake.startBeat, mintedTake.endBeat]).toEqual([4, 8]);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual([
            [0, 4, originalLane.takes[0]!.id],
            [4, 8, mintedTake.id],
        ]);

        await undo();
        flushAutomergeStorageWrites();

        // The undo's restore leg puts the whole pre-split lane back over the
        // fragmented one — deleting the restoreTakeReKeyTransitions call in
        // splitClipWithUndo leaves the split-shaped facets here and reddens.
        expect(lane()).toEqual(originalLane);

        await redo();
        flushAutomergeStorageWrites();

        // The redo re-splits with stable ids: the same minted take id comes
        // back on the re-created right fragment.
        expect(lane().takes.map((candidate) => candidate.id)).toEqual([originalLane.takes[0]!.id, mintedTake.id]);
        expect(lane().activeCompRegions.map((region) => [region.startBeat, region.endBeat, region.takeId])).toEqual([
            [0, 4, originalLane.takes[0]!.id],
            [4, 8, mintedTake.id],
        ]);
    });

    it('retires a right-half take on split undo and reinstates it on redo, through the command handler (#4521)', async () => {
        // Split through the command path so the restoreClipSplitState payloads are
        // the real producer shape — rightClip null on the undo's replacement.
        await executeAppAction({ type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } }, { source: 'manual' });
        const splitRightClipId = rightClipId();

        // A take lands on the right half after the split — no local undo entry
        // names it, so only the undo's capture can carry it to the redo.
        const take = createTake(splitRightClipId, 'Right take', 4, 8);
        const lane: TakeLane = { ...createTakeLane('track-1'), takes: [take] };
        takeLaneStore.set({ lanes: [lane] });
        flushAutomergeStorageWrites();

        await undo();
        expect((trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)).toEqual(['clip-1']);
        // The undo filtered the right clip out; its take lanes retire with it.
        expect(takeLaneStore.value?.lanes).toEqual([]);

        await redo();
        expect([...(trackStore.value?.tracks[0]?.clips ?? []).map((clip) => clip.id)].sort()).toEqual(
            [splitRightClipId, 'clip-1'].sort()
        );
        expect(takeLaneStore.value?.lanes[0]?.takes.map((candidate) => candidate.id)).toEqual([take.id]);
    });

    it.each([
        { mode: 'off', ratio: 1, consumed: 1 },
        { mode: 'timestretch', ratio: 2, consumed: 2 },
        { mode: 'off', ratio: 2, consumed: 1 },
    ] as const)(
        'keeps bounded pass media and warp source coordinates across a tempo-change split with $mode ratio $ratio',
        async ({ mode, ratio, consumed }) => {
            tempoMapStore.set({
                changes: [
                    { id: 'tempo-start', beat: 0, tempo: 120, curve: 'instant' },
                    { id: 'tempo-drop', beat: 9, tempo: 60, curve: 'instant' },
                ],
            });
            const originalClip = ClipDummy.create({
                id: 'clip-1',
                startBeat: 8,
                endBeat: 12,
                stretchMode: mode,
                stretchRatio: ratio,
            });
            trackStore.set({ ...trackStore.value!, tracks: [TrackDummy.create({ clips: [originalClip] })] });
            const take = {
                ...createTake('clip-1', 'Recorded pass', 8, 12, 0),
                passAnchorSeconds: 1.25 * consumed,
                passDepthSeconds: 1.25 * consumed,
                passSourceEndSeconds: 1.75 * consumed,
            };
            takeLaneStore.set({
                lanes: [
                    {
                        ...createTakeLane('track-1'),
                        takes: [take],
                        activeCompRegions: [{ startBeat: 9.75, endBeat: 10.25, takeId: take.id }],
                    },
                ],
            });
            const between = {
                id: 'between-old-and-source-cut',
                originalBeat: 2.5 * consumed,
                warpedBeat: 2.5 * consumed,
            };
            const after = { id: 'after-source-cut', originalBeat: 3.5 * consumed, warpedBeat: 3.5 * consumed };
            setWarpState('clip-1', {
                enabled: true,
                markers: [between, after],
                stretchMode: 'repitch',
                originalTempo: 120,
            });
            flushAutomergeStorageWrites();
            const originalLane = structuredClone(lane());
            const originalWarp = structuredClone(warpStates.get('clip-1'));
            const clips = () => trackStore.value!.tracks[0]!.clips;
            const selected = () =>
                resolveClipsWithComping('track-1', clips()).filter(
                    (fragment) => fragment.startBeat >= 9.75 && fragment.endBeat <= 10.25
                );
            expect(selected().map((fragment) => [fragment.startBeat, fragment.endBeat])).toEqual([[9.75, 10.25]]);

            await executeAppAction(
                { type: 'splitClip', payload: { clipId: 'clip-1', beat: 10, resolvedBeat: 10 } },
                { source: 'manual' }
            );

            expect(selected().map((fragment) => [fragment.startBeat, fragment.endBeat])).toEqual([
                [9.75, 10],
                [10, 10.25],
            ]);
            const right = clips().find((clip) => clip.id !== 'clip-1')!;
            const rightTempo = readTempoAtBeat({ beat: right.startBeat });
            expect(((right.audioOffsetBeats ?? 0) * 60) / rightTempo).toBe(1.5 * consumed);
            expect(selected().find((fragment) => fragment.startBeat === 10)?.audioOffsetBeats).toBe(1.5 * consumed);
            expect(lane().takes.map((pass) => pass.passSourceEndSeconds)).toEqual([1.75 * consumed, 1.75 * consumed]);
            expect(warpStates.get('clip-1')?.markers).toEqual([between]);
            expect(warpStates.get(right.id)?.markers).toEqual([after]);
            const splitClips = structuredClone(clips());
            const splitLane = structuredClone(lane());
            const splitWarps = structuredClone([...warpStates.entries()]);

            await undo();
            flushAutomergeStorageWrites();
            expect(clips()).toEqual([originalClip]);
            expect(lane()).toEqual(originalLane);
            expect(warpStates.get('clip-1')).toEqual(originalWarp);
            expect(warpStates.has(right.id)).toBe(false);
            expect(selected().map((fragment) => [fragment.startBeat, fragment.endBeat])).toEqual([[9.75, 10.25]]);

            await redo();
            flushAutomergeStorageWrites();
            expect(clips()).toEqual(splitClips);
            expect(lane()).toEqual(splitLane);
            expect([...warpStates.entries()]).toEqual(splitWarps);
            expect(selected().map((fragment) => [fragment.startBeat, fragment.endBeat])).toEqual([
                [9.75, 10],
                [10, 10.25],
            ]);
        }
    );
});
