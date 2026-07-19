import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: false }));

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => null,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        getTrackStrip: vi.fn(),
        setTrackGain: vi.fn(),
        setTrackPan: vi.fn(),
    },
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
}));

const { handleWebMidiCC } = await import('../handleWebMidiCC');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');

type HandleWebMidiCCDependencies = Parameters<typeof handleWebMidiCC._factory>[0];

function make_dependencies(overrides: Partial<HandleWebMidiCCDependencies> = {}): HandleWebMidiCCDependencies {
    return {
        getMidiLearnState: () => ({
            mappings: [],
            isLearning: false,
            learningTarget: null,
        }),
        completeMidiLearn: () => {},
        applyMidiMappings: () => {},
        getTrackStoreState: () => ({ tracks: [], selectedTrackId: null }),
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        ...overrides,
    };
}

describe('handleWebMidiCC', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        mpe_enabled.value = false;
    });

    it('should complete MIDI learn and skip ordinary mapping while learning', () => {
        const complete_midi_learn = vi.fn<(channel: number, cc: number) => void>();
        const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number) => void>();
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                getMidiLearnState: () => ({
                    mappings: [],
                    isLearning: true,
                    learningTarget: {
                        targetType: 'trackGain',
                        trackId: 'track-1',
                    },
                }),
                completeMidiLearn: complete_midi_learn,
                applyMidiMappings: apply_midi_mappings,
            })
        );

        fn(2, 74, 91);

        expect(complete_midi_learn).toHaveBeenCalledWith(2, 74);
        expect(apply_midi_mappings).not.toHaveBeenCalled();
    });

    it('should dispatch ordinary CC values to MIDI learn mappings when not learning', () => {
        const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number) => void>();
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                applyMidiMappings: apply_midi_mappings,
            })
        );

        fn(3, 7, 100);

        expect(apply_midi_mappings).toHaveBeenCalledWith(3, 7, 100);
    });

    it('should store MPE slide on the active note for the matching channel', () => {
        mpe_enabled.value = true;
        const matchingKey = createWebMidiNoteKey(4, 60);
        const otherKey = createWebMidiNoteKey(5, 60);
        activeNotes.set(matchingKey, {
            channel: 4,
            note: 60,
            trackId: 'track-a',
            instrumentTrackId: 'track-a',
            startTime: 0,
            startBeat: 0,
        });
        activeNotes.set(otherKey, {
            channel: 5,
            note: 60,
            trackId: 'track-b',
            instrumentTrackId: 'track-b',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(4, matchingKey);
        channelToNote.set(5, otherKey);
        const fn = handleWebMidiCC._factory(make_dependencies());

        fn(4, 74, 52);

        expect(activeNotes.get(matchingKey)?.slide).toBe(52);
        expect(activeNotes.get(otherKey)?.slide).toBeUndefined();
    });
});
