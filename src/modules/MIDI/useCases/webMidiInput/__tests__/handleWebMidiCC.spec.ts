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

const apply_note_expression = vi.hoisted(() => vi.fn());

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: {
        context: { currentTime: 2, sampleRate: 48000 },
        getTrackStrip: get_track_strip,
        setTrackGain: set_track_gain,
        setTrackPan: set_track_pan,
    },
    applyNoteExpression: apply_note_expression,
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
}));

const { handleWebMidiCC } = await import('../handleWebMidiCC');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');
const { resetChannelControllerState } = await import('../../../repositories/webMidi/resetChannelControllerState');

type HandleWebMidiCCDependencies = Parameters<typeof handleWebMidiCC._factory>[0];

/**
 * Frame live expression lands on with the harness clock at 2 s / 48 kHz and no
 * event timestamp: the arrival frame plus the one-render-quantum scheduling
 * budget `resolveInputDispatchFrame` applies (audit MD-1).
 */
const LIVE_DISPATCH_FRAME = 96_128;

function make_dependencies(overrides: Partial<HandleWebMidiCCDependencies> = {}): HandleWebMidiCCDependencies {
    return {
        getMidiLearnState: () => ({
            mappingsSchemaVersion: 1,
            mappings: [],
            isLearning: false,
            learningTarget: null,
        }),
        completeMidiLearn: () => {},
        applyMidiMappings: () => {},
        getTrackStoreState: () => ({ tracks: [], selectedTrackId: null }),
        eventBus: { emit: () => Promise.resolve(), on: () => () => {} },
        panicLiveNotes: () => {},
        ...overrides,
    };
}

describe('handleWebMidiCC', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        resetChannelControllerState();
        apply_note_expression.mockClear();
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
                    mappingsSchemaVersion: 1,
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

        // Fourth argument is the resolved 0..1 position (MD-7); a 7-bit-only
        // controller resolves at 7-bit so it is still value/127.
        expect(apply_midi_mappings).toHaveBeenCalledWith(3, 7, 100, 100 / 127);
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
        // audit MD-2 — slide must also reach the instrument voice, addressed to
        // the matching note only.
        expect(apply_note_expression).toHaveBeenCalledTimes(1);
        expect(apply_note_expression).toHaveBeenCalledWith({
            trackId: 'track-a',
            note: 60,
            channel: 4,
            expression: { pitchBend: undefined, pressure: undefined, slide: 52 },
            sampleFrame: LIVE_DISPATCH_FRAME,
        });
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
        expect(apply_midi_mappings).toHaveBeenCalledWith(0, 7, 100, 100 / 127);
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

        expect(apply_midi_mappings).toHaveBeenCalledWith(0, 74, 40, 40 / 127);
    });

    describe('high-resolution 14-bit CC (audit MD-7)', () => {
        it('drives track gain from the assembled 14-bit pair, not the truncated MSB', () => {
            target_track_id.value = 'track-1';
            const fn = handleWebMidiCC._factory(make_dependencies());

            // Channel Volume MSB, then its LSB on controller 39.
            fn(0, 7, 100);
            fn(0, 39, 43);

            expect(set_track_gain).toHaveBeenLastCalledWith('track-1', ((100 << 7) | 43) / 16383);
        });

        it('separates two LSB refinements a 7-bit path would collapse to one gain', () => {
            target_track_id.value = 'track-1';
            const fn = handleWebMidiCC._factory(make_dependencies());

            fn(0, 7, 100);
            fn(0, 39, 0);
            const coarse = set_track_gain.mock.calls.at(-1)?.[1];
            fn(0, 39, 127);
            const fine = set_track_gain.mock.calls.at(-1)?.[1];

            expect(coarse).not.toBe(fine);
            expect(fine).toBeGreaterThan(coarse as number);
        });

        it('addresses a mapping by the MSB controller number when the LSB arrives', () => {
            const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number, position: number) => void>();
            const fn = handleWebMidiCC._factory(make_dependencies({ applyMidiMappings: apply_midi_mappings }));

            fn(0, 7, 64);
            fn(0, 39, 64);

            expect(apply_midi_mappings).toHaveBeenLastCalledWith(0, 7, 64, ((64 << 7) | 64) / 16383);
        });

        it('still lets a 7-bit-only Channel Volume reach unity gain', () => {
            target_track_id.value = 'track-1';
            const fn = handleWebMidiCC._factory(make_dependencies());

            fn(0, 7, 127);

            expect(set_track_gain).toHaveBeenLastCalledWith('track-1', 1);
        });
    });

    describe('registered parameters (audit MD-8)', () => {
        it('does not dispatch the RPN select or Data Entry messages as ordinary CCs', () => {
            target_track_id.value = 'track-1';
            const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number, position: number) => void>();
            const fn = handleWebMidiCC._factory(make_dependencies({ applyMidiMappings: apply_midi_mappings }));

            fn(0, 101, 0);
            fn(0, 100, 0);
            fn(0, 6, 12);
            fn(0, 38, 0);

            expect(apply_midi_mappings).not.toHaveBeenCalled();
        });

        it('returns controller 6 to ordinary dispatch once the Null RPN deselects', () => {
            const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number, position: number) => void>();
            const fn = handleWebMidiCC._factory(make_dependencies({ applyMidiMappings: apply_midi_mappings }));

            fn(0, 101, 0);
            fn(0, 100, 0);
            fn(0, 6, 12);
            fn(0, 101, 127);
            fn(0, 100, 127);
            fn(0, 6, 96);

            expect(apply_midi_mappings).toHaveBeenCalledTimes(1);
            expect(apply_midi_mappings).toHaveBeenCalledWith(0, 6, 96, 96 / 127);
        });
    });

    describe('channel-mode panic messages (audit MD-6)', () => {
        it('panics on an incoming All Sound Off instead of treating it as a controller', () => {
            const panic = vi.fn();
            const apply_midi_mappings = vi.fn<(channel: number, cc: number, value: number, position: number) => void>();
            const fn = handleWebMidiCC._factory(
                make_dependencies({ panicLiveNotes: panic, applyMidiMappings: apply_midi_mappings })
            );

            fn(0, 120, 0);

            expect(panic).toHaveBeenCalledTimes(1);
            expect(apply_midi_mappings).not.toHaveBeenCalled();
        });

        it('panics on an incoming All Notes Off', () => {
            const panic = vi.fn();
            const fn = handleWebMidiCC._factory(make_dependencies({ panicLiveNotes: panic }));

            fn(5, 123, 0);

            expect(panic).toHaveBeenCalledTimes(1);
        });

        it('does not echo the panic back out, which a loopback port would repeat forever', () => {
            const panic = vi.fn<(input?: { notifyOutputs?: boolean }) => void>();
            const fn = handleWebMidiCC._factory(make_dependencies({ panicLiveNotes: panic }));

            fn(0, 123, 0);

            expect(panic).toHaveBeenCalledWith({ notifyOutputs: false });
        });

        it('does not panic on an ordinary controller', () => {
            const panic = vi.fn();
            const fn = handleWebMidiCC._factory(make_dependencies({ panicLiveNotes: panic }));

            fn(0, 74, 40);
            fn(0, 7, 100);

            expect(panic).not.toHaveBeenCalled();
        });
    });
});
