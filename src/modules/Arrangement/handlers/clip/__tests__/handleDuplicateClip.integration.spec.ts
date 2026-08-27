import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppActionBatch,
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

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { getEnvelope, setAllEnvelopes, setEnvelope } from '../../../stores/gainEnvelopeStore';
import { warpStates } from '../../../stores/warpStates';
import { setStretchMode } from '../../../useCases';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

describe('handleDuplicateClip atomic integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('duplicate clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setAllEnvelopes({});
        const clip = ClipDummy.create({ id: 'clip-1', startBeat: 0, endBeat: 4 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        setAllEnvelopes({});
        warpStates.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits through a compensable atomic batch and undo removes the duplicate', async () => {
        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(2);
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1');
        expect(duplicated).toBeDefined();

        await undo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
    });

    it('carries the clip gain envelope onto the duplicate and drops it again on undo', async () => {
        setEnvelope('clip-1', {
            clipId: 'clip-1',
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: -6 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });

        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1');
        expect(duplicated).toBeDefined();
        // The copy owns an equivalent envelope under its own id; the source's is untouched.
        expect(getEnvelope(duplicated!.id)).toEqual({
            clipId: duplicated!.id,
            enabled: true,
            points: [
                { id: 'p1', beatOffset: 0, gainDb: -6 },
                { id: 'p2', beatOffset: 2, gainDb: 0 },
            ],
        });
        expect(getEnvelope('clip-1')?.clipId).toBe('clip-1');

        await undo();

        expect(getEnvelope(duplicated!.id)).toBeUndefined();
        expect(getEnvelope('clip-1')?.points).toHaveLength(2);
    });

    it('still undoes the duplicate after a semantic no-op warp write on the copy', async () => {
        const result = await executeAppActionBatch([{ type: 'duplicateClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });
        expect(result.status).toBe('committed');
        const duplicated = trackStore.value!.tracks[0]!.clips.find((clip) => clip.id !== 'clip-1')!;

        // Re-selecting the already-active stretch mode writes a map entry whose
        // value IS defaultWarpState — by the system's own definition
        // (hasNonDefaultWarpState) the copy still carries no warp state, so the
        // captured satellite guard must still match and undo must still run.
        setStretchMode(duplicated.id, 'repitch');
        expect(warpStates.has(duplicated.id)).toBe(true);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips).toHaveLength(1);
        expect(trackStore.value?.tracks[0]?.clips[0]?.id).toBe('clip-1');
    });
});
