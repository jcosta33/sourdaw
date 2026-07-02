import { beforeEach, describe, expect, it, vi } from 'vitest';

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
        activeNotes.set(64, {
            channel: 2,
            startTime: 0,
            startBeat: 0,
            osc: {
                detune: { setTargetAtTime: set_target_at_time },
            } as unknown as OscillatorNode & { _env?: GainNode },
        });
        channelToNote.set(2, 64);
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        fn(2, 0, 65);

        expect(activeNotes.get(64)?.pitchBend).toBe(128);
        expect(set_target_at_time).toHaveBeenCalledWith(80, 2, 0.003);
    });
});
