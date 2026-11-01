import { afterEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { setMpeEnabledInternal } from '../../../repositories/webMidi/setMpeEnabledInternal';
import { activeNotes } from '../../../repositories/webMidi/state';

const appended = vi.hoisted(() => [] as { clipId: string; note: Record<string, unknown> }[]);

vi.mock('../../appendRecordedMidiNote', () => ({
    appendRecordedMidiNote: (input: { clipId: string; note: Record<string, unknown> }) => {
        appended.push(input);
    },
}));

vi.mock('../resolveRecordingPlacement', () => ({
    resolveRecordingPlacement: () => ({
        clipId: 'clip-1',
        clipBeat: 4,
        latencyAdjustedBeat: 4,
        originSeconds: 0,
        defaultTempo: 120,
        flatTimeline: true,
    }),
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { context: { currentTime: 3, sampleRate: 48_000, baseLatency: 0, outputLatency: 0 } },
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: vi.fn(() => false),
}));

const { sealHeldRecordedMidiNotes } = await import('../sealHeldRecordedMidiNotes');

describe('sealHeldRecordedMidiNotes', () => {
    afterEach(() => {
        activeNotes.clear();
        appended.length = 0;
        setMpeEnabledInternal(false);
    });

    it.each([false, true])('keeps the channel a key held through Stop sounded on (MPE %s)', (mpe) => {
        // Stored playback bends a note only by its own channel's recorded wheel, as the live input does.
        setMpeEnabledInternal(mpe);
        activeNotes.set(createWebMidiNoteKey(6, 64), {
            channel: 6,
            note: 64,
            velocity: 70,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            recordingClipId: 'clip-1',
            startTime: 1,
            startBeat: 4,
        });

        sealHeldRecordedMidiNotes({ clipId: 'clip-1', trackId: 'track-1', endAudioTime: 2 });

        expect(appended).toHaveLength(1);
        expect(appended[0]?.note).toMatchObject({ pitch: 64, startBeat: 4, duration: 2, channel: 6 });
    });
});
