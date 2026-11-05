import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';

import { createTrack } from '../../../models/Track';
import { handleRestoreClipStretchState } from '../../clipStretch/handleRestoreClipStretchState';
import { handleTrimClipEnd } from '../handleTrimClipEnd';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => { length: number; sampleRate: number } | null>(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

/**
 * A clip at beat 2 entering its 4 s source 1 beat in at 120 BPM: its source
 * runs out on beat 9, so a trim past there stops on 9.
 */
function seed(endBeat: number): void {
    const clip: Clip = {
        id: 'clip-1',
        trackId: 'track-1',
        name: 'Take',
        type: 'audio',
        audioBufferId: 'buffer-1',
        audioOffsetBeats: 1,
        startBeat: 2,
        endBeat,
        fadeInBeats: 0,
        fadeOutBeats: 0,
        gain: 1,
        color: '',
        locked: false,
        muted: false,
    };
    const track = createTrack({ id: 'track-1', name: 'Audio', kind: 'audio', withoutDefaultDevice: true });
    trackStore.set({ ...defaultTrackState, tracks: [{ ...track, clips: [clip] }] });
}

function endBeat(): number | undefined {
    return trackStore.value?.tracks[0]?.clips[0]?.endBeat;
}

/** Trims through the real handler, keeping the inverse it recorded. */
function trimAndKeepInverse(newEndBeat: number): AppAction {
    const action = { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat } } as const;
    const description = handleTrimClipEnd.describe(action);
    expect(handleTrimClipEnd.execute(action)).toEqual({ status: 'written' });
    if (!description.inverseAction) {
        throw new Error('Expected a trim inverse action');
    }
    return description.inverseAction;
}

function executeInverse(inverse: AppAction): unknown {
    if (inverse.type === 'trimClipEnd') {
        return handleTrimClipEnd.execute(inverse);
    }
    if (inverse.type === 'restoreClipStretchState') {
        return handleRestoreClipStretchState.execute(inverse);
    }
    throw new Error(`Unexpected inverse ${inverse.type}`);
}

describe('undoing a source-bounded audio clip end trim', () => {
    let previousTransport: typeof transportStore.value;
    let previousTempoMap: typeof tempoMapStore.value;

    beforeEach(() => {
        previousTransport = transportStore.value;
        previousTempoMap = tempoMapStore.value;
        transportStore.set({ ...defaultTransportState, tempo: 120 });
        tempoMapStore.set({ changes: [{ id: 'tempo-0', beat: 0, tempo: 120, curve: 'instant' }] });
        mocks.getCachedAudioBuffer.mockImplementation(({ bufferId }) =>
            bufferId === 'buffer-1' ? { length: 4 * 48_000, sampleRate: 48_000 } : null
        );
    });

    afterEach(() => {
        transportStore.set(previousTransport);
        tempoMapStore.set(previousTempoMap);
        trackStore.set(defaultTrackState);
    });

    it('restores the pre-trim end after a lengthening trim the source stopped short', () => {
        seed(4);
        const inverse = trimAndKeepInverse(12);
        expect(endBeat()).toBeCloseTo(9, 9);

        expect(executeInverse(inverse)).toEqual({ status: 'written' });

        expect(endBeat()).toBe(4);
    });

    it('restores the pre-trim end of a clip that ended past its source before a shortening trim', () => {
        seed(11);
        const inverse = trimAndKeepInverse(6);
        expect(endBeat()).toBe(6);

        expect(executeInverse(inverse)).toEqual({ status: 'written' });

        expect(endBeat()).toBe(11);
    });

    it('keeps the plain trim inverse for a shortening trim of a clip within its source', () => {
        seed(8);

        const inverse = trimAndKeepInverse(5);

        expect(inverse).toEqual({ type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 8 } });
        expect(executeInverse(inverse)).toEqual({ status: 'written' });
        expect(endBeat()).toBe(8);
    });
});
