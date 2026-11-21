import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { registerProjectSlotProjections } from '#/app/registerProjectSlotProjections';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { clearHandlerRegistry, macroStore, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { FREEZE_BAKE_VERSION } from '#/utils/frozenBufferTail';

import { TrackDummy } from '../../../__tests__/TrackDummy';
import { takeLaneStore } from '../../../stores/takeLaneStore';
import { trackStore } from '../../../stores/trackStore';
import { initStalenessDetection } from '../../../useCases/freezeBounce/initStalenessDetection';
import { getArrangementHandlers } from '../../../useCases/getArrangementHandlers';
import { startRecording } from '../../../useCases/recording/startRecording';
import { updateTrack } from '../../../useCases/updateTrack';

const TRACK_ID = 'track-midi';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function readTrack() {
    const track = trackStore.value?.tracks.find((candidate) => candidate.id === TRACK_ID);
    if (!track) {
        throw new Error('expected the MIDI track');
    }
    return track;
}

function freezeTrackInStore(): void {
    updateTrack(TRACK_ID, (track) => ({
        ...track,
        frozen: true,
        frozenBufferId: 'frozen-buffer',
        freezeState: {
            status: 'frozen',
            frozenBufferId: 'frozen-buffer',
            sourceContentHash: 'hash-before-the-take',
            renderSettings: {
                sampleRate: 44_100,
                bitDepth: 32,
                channelCount: 2,
                tailLengthSeconds: 0,
                bakeVersion: FREEZE_BAKE_VERSION,
            },
        },
    }));
    flushAutomergeStorageWrites();
}

describe('recording onto a frozen track (issue #7239)', () => {
    beforeEach(() => {
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('frozen track recording integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        registerProjectSlotProjections();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        trackStore.set({
            tracks: [TrackDummy.create({ id: TRACK_ID, kind: 'midi', armed: false, clips: [] })],
            selectedTrackId: TRACK_ID,
            ghostClips: [],
        });
        takeLaneStore.set({ lanes: [] });
        transportStore.set({ ...transportStore.value!, playheadPosition: 4 });
    });

    afterEach(() => {
        clearHandlerRegistry();
        clearUndoHistory();
        resetActionReplayAuthority();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        takeLaneStore.set({ lanes: [] });
        flushAutomergeStorageWrites();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('still lets a frozen track be armed, so unfreezing needs no second arm', async () => {
        freezeTrackInStore();

        await executeAppAction({ type: 'armTrack', payload: { trackId: TRACK_ID, armed: true } });

        expect(readTrack().armed).toBe(true);
    });

    it('opens no recording clip on an armed track that is frozen', () => {
        updateTrack(TRACK_ID, (track) => ({ ...track, armed: true }));
        freezeTrackInStore();

        const clips = startRecording(4);

        expect(clips).toEqual([]);
        expect(readTrack().clips).toEqual([]);
    });

    it('keeps a take committed after the track froze mid-recording and marks the freeze stale', async () => {
        updateTrack(TRACK_ID, (track) => ({ ...track, armed: true }));
        const [provisional] = startRecording(4);
        if (!provisional) {
            throw new Error('expected a provisional recording clip');
        }
        flushAutomergeStorageWrites();
        freezeTrackInStore();
        const unsubscribeStaleness = initStalenessDetection();

        try {
            await executeAppAction({
                type: 'commitRecording',
                payload: { clip: { ...provisional, endBeat: 8, name: 'Recorded take' } },
            });
            flushAutomergeStorageWrites();

            expect(readTrack().clips.map((clip) => [clip.name, clip.endBeat])).toEqual([['Recorded take', 8]]);
            await vi.waitFor(() => {
                expect(readTrack().freezeState.status).toBe('stale');
            });
        } finally {
            unsubscribeStaleness();
        }
    });
});
