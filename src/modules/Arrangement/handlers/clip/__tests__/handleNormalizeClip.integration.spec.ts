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

const audioMocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: audioMocks.getCachedAudioBuffer,
}));

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function createPeakHalfBuffer(): AudioBuffer {
    const samples = new Float32Array([0.5, -0.5]);
    const sampleRate = 48_000;
    return {
        duration: samples.length / sampleRate,
        length: samples.length,
        numberOfChannels: 1,
        sampleRate,
        copyFromChannel: (destination, channelNumber, startInChannel = 0) => {
            if (channelNumber !== 0) {
                throw new RangeError('Only channel 0 exists');
            }
            destination.set(samples.subarray(startInChannel, startInChannel + destination.length));
        },
        copyToChannel: (source, channelNumber, startInChannel = 0) => {
            if (channelNumber !== 0) {
                throw new RangeError('Only channel 0 exists');
            }
            samples.set(source, startInChannel);
        },
        getChannelData: (channelNumber) => {
            if (channelNumber !== 0) {
                throw new RangeError('Only channel 0 exists');
            }
            return samples;
        },
    };
}

describe('handleNormalizeClip atomic integration', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('normalize clip atomic integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        const clip = ClipDummy.create({ id: 'clip-1', audioBufferId: 'buffer-1', gain: 0.5 });
        const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
        trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
        audioMocks.getCachedAudioBuffer.mockReturnValue(createPeakHalfBuffer());
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    it('commits through a compensable atomic batch and undo restores the previous gain', async () => {
        const result = await executeAppActionBatch([{ type: 'normalizeClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(result.status).toBe('committed');
        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(2);

        const repeated = await executeAppActionBatch([{ type: 'normalizeClip', payload: { clipId: 'clip-1' } }], {
            source: 'prompt',
            requireCompensation: true,
        });

        expect(repeated.status).toBe('no-op');
        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(2);

        await undo();

        expect(trackStore.value?.tracks[0]?.clips[0]?.gain).toBe(0.5);
    });
});
