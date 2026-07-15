import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: true }));
const target_track_id = vi.hoisted(() => ({ value: 'track-1' as string | null }));

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => target_track_id.value,
}));

vi.mock('../../../repositories/createWebAudioEngine', () => ({
    audioEngine: {
        context: { currentTime: 2 },
    },
}));

const { handleWebMidiPitchBend } = await import('../handleWebMidiPitchBend');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

type HandleWebMidiPitchBendDependencies = Parameters<typeof handleWebMidiPitchBend._factory>[0];

function make_dependencies(
    overrides: Partial<HandleWebMidiPitchBendDependencies> = {}
): HandleWebMidiPitchBendDependencies {
    return {
        getSynthParamsForTrack: () => ({ detune: 5 }),
        ...overrides,
    } as unknown as HandleWebMidiPitchBendDependencies;
}

describe('handleWebMidiPitchBend', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        mpe_enabled.value = true;
        target_track_id.value = 'track-1';
    });

    it('should store MPE pitch bend and retune only the note on the matching channel', () => {
        const set_target_at_time = vi.fn<void, [number, number, number]>();
        const matchingKey = createWebMidiNoteKey(2, 64);
        const otherKey = createWebMidiNoteKey(3, 64);
        activeNotes.set(matchingKey, {
            channel: 2,
            note: 64,
            trackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: {
                detune: { setTargetAtTime: set_target_at_time },
            } as unknown as OscillatorNode & { _env?: GainNode },
        });
        activeNotes.set(otherKey, {
            channel: 3,
            note: 64,
            trackId: 'track-2',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(2, matchingKey);
        channelToNote.set(3, otherKey);
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        fn(2, 0, 65);

        expect(activeNotes.get(matchingKey)?.pitchBend).toBe(128);
        expect(activeNotes.get(otherKey)?.pitchBend).toBeUndefined();
        expect(set_target_at_time).toHaveBeenCalledWith(80, 2, 0.003);
    });
});
