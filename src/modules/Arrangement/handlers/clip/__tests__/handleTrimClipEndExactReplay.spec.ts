import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type Clip, defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';

import { createTrack } from '../../../models/Track';
import { handleTrimClipEnd } from '../handleTrimClipEnd';

const mocks = vi.hoisted(() => ({
    getCachedAudioBuffer: vi.fn<(input: { bufferId: string }) => { length: number; sampleRate: number } | null>(),
}));

vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    getCachedAudioBuffer: mocks.getCachedAudioBuffer,
}));

/**
 * A clip at beat 2 entering its cached 4 s source 1 beat in at 120 BPM: the
 * source runs out on beat 9. The handler writes ends exactly, so history can
 * restore an end past that beat.
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

describe('trimClipEnd writes the end it is given, past the source or not', () => {
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

    it.each([
        { name: 'on its own', context: undefined },
        {
            name: 'after another member of its batch',
            context: {
                actions: [
                    { type: 'setClipGain', payload: { clipId: 'clip-1', gain: 0.5 } } as const,
                    { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } } as const,
                ],
                actionIndex: 1,
            },
        },
    ])('undoes a shortening $name back to an end past the source', ({ context }) => {
        seed(11);
        const trim = { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } } as const;
        const { inverseAction } = handleTrimClipEnd.describe(trim, context);
        expect(handleTrimClipEnd.execute(trim)).toEqual({ status: 'written' });
        expect(endBeat()).toBe(6);

        expect(inverseAction).toEqual({ type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 11 } });
        if (inverseAction?.type !== 'trimClipEnd') {
            throw new Error('Expected a trimClipEnd inverse');
        }
        expect(handleTrimClipEnd.execute(inverseAction)).toEqual({ status: 'written' });

        expect(endBeat()).toBe(11);
    });

    it('writes a requested end past the source, leaving the bound to the gesture that forms it', () => {
        seed(4);

        expect(
            handleTrimClipEnd.execute({ type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 12 } })
        ).toEqual({ status: 'written' });

        expect(endBeat()).toBe(12);
    });
});
