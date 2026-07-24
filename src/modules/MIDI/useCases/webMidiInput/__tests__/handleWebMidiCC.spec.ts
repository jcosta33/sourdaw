import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: false }));
const target_track_id = vi.hoisted(() => ({ value: null as string | null }));
const set_track_gain = vi.hoisted(() => vi.fn());
const set_track_pan = vi.hoisted(() => vi.fn());
const get_track_strip = vi.hoisted(() => vi.fn());

vi.mock('../../../repositories/webMidi/getMpeEnabled', () => ({
    getMpeEnabled: () => mpe_enabled.value,
}));

vi.mock('../../../repositories/webMidi/getTargetTrackId', () => ({
    getTargetTrackId: () => target_track_id.value,
}));

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        getTrackStrip: get_track_strip,
        setTrackGain: set_track_gain,
        setTrackPan: set_track_pan,
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
        target_track_id.value = null;
        set_track_gain.mockReset();
        set_track_pan.mockReset();
        get_track_strip.mockReset();
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

    it('maps CC 7 (Channel Volume) to track gain normalized to 0..1', () => {
        // CC 7 is the standard Channel Volume controller. Max (127) is full gain 1.0.
        target_track_id.value = 'track-1';
        const fn = handleWebMidiCC._factory(make_dependencies());

        fn(0, 7, 127);

        expect(set_track_gain).toHaveBeenCalledWith('track-1', 1);
    });

    it('maps CC 10 (Pan) center (64) to approximately centered pan', () => {
        // CC 10 center is 64; the pan curve ((value/127)*2-1)*50 should be ~0 at center.
        target_track_id.value = 'track-1';
        const fn = handleWebMidiCC._factory(make_dependencies());

        fn(0, 10, 64);

        // ((64/127)*2-1)*50 ≈ 0.39 — near center (MIDI pan center is 64; the curve maps it
        // close to, but not exactly, 0 because it divides by 127 rather than the 63.5 span).
        expect(set_track_pan).toHaveBeenCalledWith('track-1', expect.closeTo(0.39, 1));
        expect(set_track_gain).not.toHaveBeenCalled();
    });

    it('maps CC 10 full-left (0) to the negative pan extreme', () => {
        target_track_id.value = 'track-1';
        const fn = handleWebMidiCC._factory(make_dependencies());

        fn(0, 10, 0);

        // ((0/127)*2-1)*50 = -50
        expect(set_track_pan).toHaveBeenCalledWith('track-1', -50);
    });

    it('still applies MIDI mappings but skips engine gain/pan when no target track is set', () => {
        target_track_id.value = null;
        const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number) => void>();
        const fn = handleWebMidiCC._factory(make_dependencies({ applyMidiMappings: apply_midi_mappings }));

        fn(0, 7, 100);

        // Mappings are global (learn) and must run regardless of selection...
        expect(apply_midi_mappings).toHaveBeenCalledWith(0, 7, 100);
        // ...but engine gain/pan require a selected target track.
        expect(set_track_gain).not.toHaveBeenCalled();
    });

    it('forwards sustain pedal CC 64 to a Grand Boule as a normalized 0..1 sustain', () => {
        target_track_id.value = 'track-1';
        const set_sustain = vi.fn<(value: number) => void>();
        const emitted: Array<{ type: string; payload: Record<string, unknown> }> = [];
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'gb-1', type: 'grand-boule' }] }],
                    selectedTrackId: 'track-1',
                }),
                eventBus: {
                    emit: (type: string, payload: Record<string, unknown>) => {
                        emitted.push({ type, payload });
                        return Promise.resolve();
                    },
                    on: () => () => {},
                },
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { ready: true, setSustain: set_sustain },
                },
            ],
        });

        fn(0, 64, 127);

        // Full sustain = 1.0.
        expect(set_sustain).toHaveBeenCalledWith(1);
        expect(emitted).toContainEqual({
            type: 'midi.pedalCc',
            payload: { deviceId: 'gb-1', cc: 64, value: 1 },
        });
    });

    it('treats sostenuto CC 66 as a switch (on only at value >= 64)', () => {
        target_track_id.value = 'track-1';
        const set_sostenuto = vi.fn<(on: boolean) => void>();
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'gb-1', type: 'grand-boule' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { ready: true, setSostenuto: set_sostenuto },
                },
            ],
        });

        // Below the switch threshold: off.
        fn(0, 66, 0);
        expect(set_sostenuto).toHaveBeenLastCalledWith(false);

        // At/above threshold: on.
        fn(0, 66, 64);
        expect(set_sostenuto).toHaveBeenLastCalledWith(true);
    });

    it('treats una corda CC 67 as a switch (on only at value >= 64)', () => {
        target_track_id.value = 'track-1';
        const set_una_corda = vi.fn<(on: boolean) => void>();
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'gb-1', type: 'grand-boule' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { ready: true, setUnaCorda: set_una_corda },
                },
            ],
        });

        fn(0, 67, 63);
        expect(set_una_corda).toHaveBeenLastCalledWith(false);

        fn(0, 67, 127);
        expect(set_una_corda).toHaveBeenLastCalledWith(true);
    });

    it('does not engage Grand Boule pedals when the device node is not ready', () => {
        target_track_id.value = 'track-1';
        const set_sustain = vi.fn();
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'gb-1', type: 'grand-boule' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [
                {
                    type: 'grand-boule',
                    deviceId: 'gb-1',
                    grandBouleControls: { ready: false, setSustain: set_sustain },
                },
            ],
        });

        fn(0, 64, 127);

        expect(set_sustain).not.toHaveBeenCalled();
    });

    it('forwards CC to a Levain device via handleCc', () => {
        target_track_id.value = 'track-1';
        const handle_cc = vi.fn<(cc: number, value: number) => void>();
        const fn = handleWebMidiCC._factory(
            make_dependencies({
                getTrackStoreState: () => ({
                    tracks: [{ id: 'track-1', devices: [{ id: 'lev-1', type: 'levain' }] }],
                    selectedTrackId: 'track-1',
                }),
            })
        );
        get_track_strip.mockReturnValue({
            deviceNodes: [{ type: 'levain', deviceId: 'lev-1', levainControls: { ready: true, handleCc: handle_cc } }],
        });

        fn(0, 74, 40);

        expect(handle_cc).toHaveBeenCalledWith(74, 40);
    });

    it('ignores MPE slide CC on the global channel (0) even when MPE is enabled', () => {
        // MPE slide (CC 74) is only meaningful on member channels (>= 1). On channel 0
        // (the global/manager channel) it must fall through to ordinary CC handling.
        mpe_enabled.value = true;
        target_track_id.value = 'track-1';
        const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number) => void>();
        const fn = handleWebMidiCC._factory(make_dependencies({ applyMidiMappings: apply_midi_mappings }));

        fn(0, 74, 40);

        expect(apply_midi_mappings).toHaveBeenCalledWith(0, 74, 40);
    });
});
