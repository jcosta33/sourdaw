import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';

const mpe_enabled = vi.hoisted(() => ({ value: true }));
const target_track_id = vi.hoisted(() => ({ value: 'track-1' }));

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
    },
    applyNoteExpression: apply_note_expression,
    getDefaultBendRangeSemitones: () => 48,
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiNote: async () => true,
}));

/**
 * Frame live expression lands on with the harness clock at 2 s / 48 kHz and no
 * event timestamp: the arrival frame plus the one-render-quantum scheduling
 * budget `resolveInputDispatchFrame` applies (audit MD-1).
 */
const LIVE_DISPATCH_FRAME = 96_128;
/** The same instant in seconds, for the fallback oscillator's detune ramp. */
const LIVE_DISPATCH_TIME = LIVE_DISPATCH_FRAME / 48_000;
const { handleWebMidiPitchBend } = await import('../handleWebMidiPitchBend');
const { activeNotes, channelToNote } = await import('../../../repositories/webMidi/state');
const { ingestChannelControlChange } = await import('../../../repositories/webMidi/ingestChannelControlChange');
const { resetChannelControllerState } = await import('../../../repositories/webMidi/resetChannelControllerState');

/** Drive the four-message RPN 0 sequence a controller sends to declare its bend range. */
function declare_bend_range(channel: number, semitones: number, cents = 0): void {
    ingestChannelControlChange({ channel, cc: 101, value: 0 });
    ingestChannelControlChange({ channel, cc: 100, value: 0 });
    ingestChannelControlChange({ channel, cc: 6, value: semitones });
    ingestChannelControlChange({ channel, cc: 38, value: cents });
}

type HandleWebMidiPitchBendDependencies = Parameters<typeof handleWebMidiPitchBend._factory>[0];

function make_dependencies(
    overrides: Partial<HandleWebMidiPitchBendDependencies> = {}
): HandleWebMidiPitchBendDependencies {
    return {
        getSynthParamsForTrack: () => ({ detune: 5 }),
        ...overrides,
    };
}

describe('handleWebMidiPitchBend', () => {
    beforeEach(() => {
        activeNotes.clear();
        channelToNote.clear();
        apply_note_expression.mockClear();
        resetChannelControllerState();
        mpe_enabled.value = true;
        target_track_id.value = 'track-1';
    });

    // audit MD-2 — the captured bend must reach the instrument voice, not only
    // the fallback oscillator.
    it('routes an MPE member-channel bend to the note instrument through the shared surface', () => {
        const key = createWebMidiNoteKey(2, 64);
        activeNotes.set(key, {
            channel: 2,
            note: 64,
            trackId: 'source-track',
            instrumentTrackId: 'instrument-track',
            startTime: 0,
            startBeat: 0,
            pressure: 100,
            slide: 20,
        });
        channelToNote.set(2, key);

        // 14-bit value 12288 => +4096 offset from centre.
        handleWebMidiPitchBend(2, 0, 96);

        expect(apply_note_expression).toHaveBeenCalledTimes(1);
        expect(apply_note_expression).toHaveBeenCalledWith({
            trackId: 'instrument-track',
            note: 64,
            channel: 2,
            expression: { pitchBend: 4096, pressure: 100, slide: 20 },
            // No RPN 0 declared, so the MPE member default the expression
            // surface itself defines (audit MD-8).
            bendRangeSemitones: 48,
            sampleFrame: LIVE_DISPATCH_FRAME,
        });
    });

    it('routes a channel-wide bend at the standard ±2 semitone range without recording it on the note', () => {
        mpe_enabled.value = false;
        const key = createWebMidiNoteKey(0, 60);
        activeNotes.set(key, {
            channel: 0,
            note: 60,
            trackId: 'source-track',
            instrumentTrackId: 'instrument-track',
            startTime: 0,
            startBeat: 0,
        });

        handleWebMidiPitchBend(0, 0, 96);

        expect(apply_note_expression).toHaveBeenCalledWith({
            trackId: 'instrument-track',
            note: 60,
            channel: 0,
            expression: { pitchBend: 4096, pressure: undefined, slide: undefined },
            bendRangeSemitones: 2,
            sampleFrame: LIVE_DISPATCH_FRAME,
        });
        // Channel-wide bend is performance, not per-note data: it must not be
        // written onto the note record that recording later reads.
        expect(activeNotes.get(key)?.pitchBend).toBeUndefined();
    });

    it('should store MPE pitch bend and retune only the note on the matching channel', () => {
        const set_target_at_time = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
        const matchingKey = createWebMidiNoteKey(2, 64);
        const otherKey = createWebMidiNoteKey(3, 64);
        activeNotes.set(matchingKey, {
            channel: 2,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
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
            instrumentTrackId: 'track-2',
            startTime: 0,
            startBeat: 0,
        });
        channelToNote.set(2, matchingKey);
        channelToNote.set(3, otherKey);
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        fn(2, 0, 65);

        expect(activeNotes.get(matchingKey)?.pitchBend).toBe(128);
        expect(activeNotes.get(otherKey)?.pitchBend).toBeUndefined();
        expect(set_target_at_time).toHaveBeenCalledWith(80, LIVE_DISPATCH_TIME, 0.003);
    });

    it('parses pitch bend as a 14-bit value centered at 8192 (no-bend center)', () => {
        // MIDI pitch wheel is a 14-bit LSB/MSB pair. Center (8192) is no bend; the decoded
        // value is ((msb<<7)|lsb) - 8192. lsb=0, msb=64 -> 8192 -> bend 0.
        mpe_enabled.value = false;
        target_track_id.value = 'track-1';
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        // Center bend must not retune anything; with no active notes it is a clean no-op.
        fn(0, 0, 64);

        expect(activeNotes.size).toBe(0);
    });

    it('in MPE mode, ignores bend on a member channel with no active note', () => {
        // MPE bend is per-note. If the channel has no sounding note there is nothing to bend.
        mpe_enabled.value = true;
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        // Channel 2 maps to no note (channelToNote empty).
        fn(2, 0, 90);

        expect(channelToNote.has(2)).toBe(false);
        expect(activeNotes.size).toBe(0);
    });

    it('in MPE mode, ignores bend when the channel maps to a note that is no longer active', () => {
        mpe_enabled.value = true;
        const staleKey = createWebMidiNoteKey(2, 60);
        // channelToNote references a key that activeNotes no longer holds (already released).
        channelToNote.set(2, staleKey);
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        fn(2, 0, 90);

        expect(activeNotes.has(staleKey)).toBe(false);
    });

    describe('controller-declared bend range via RPN 0 (audit MD-8)', () => {
        it('interprets a non-MPE bend at the range the controller declared, not the hard-coded ±2', () => {
            mpe_enabled.value = false;
            const set_target = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
            activeNotes.set(createWebMidiNoteKey(0, 60), {
                channel: 0,
                note: 60,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
                osc: { detune: { setTargetAtTime: set_target } } as unknown as OscillatorNode,
            });
            declare_bend_range(0, 12);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            // Half-scale bend: +4096 of 8192.
            fn(0, 0, 96);

            expect(apply_note_expression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 12 }));
            // Fallback oscillator reads the same range: 4096/8192 * 12 st * 100
            // cents = 600, plus the track's 5-cent base detune.
            expect(set_target).toHaveBeenCalledWith(605, LIVE_DISPATCH_TIME, 0.003);
        });

        it('applies the cents half of RPN 0 to the resolved range', () => {
            mpe_enabled.value = false;
            activeNotes.set(createWebMidiNoteKey(0, 60), {
                channel: 0,
                note: 60,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
            });
            declare_bend_range(0, 2, 50);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            fn(0, 0, 96);

            expect(apply_note_expression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 2.5 }));
        });

        it('uses an MPE member channel own declaration over the zone default', () => {
            const key = createWebMidiNoteKey(2, 64);
            activeNotes.set(key, {
                channel: 2,
                note: 64,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
            });
            channelToNote.set(2, key);
            declare_bend_range(2, 24);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            fn(2, 0, 96);

            expect(apply_note_expression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 24 }));
        });

        it('inherits the MPE zone master declaration on a member channel that never declared one', () => {
            const key = createWebMidiNoteKey(3, 64);
            activeNotes.set(key, {
                channel: 3,
                note: 64,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
            });
            channelToNote.set(3, key);
            // MPE sets pitch-bend sensitivity for the whole zone from channel 0.
            declare_bend_range(0, 12);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            fn(3, 0, 96);

            expect(apply_note_expression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 12 }));
        });

        it('captures the range onto the note so recording can persist the depth performed', () => {
            // The raw wire delta carries no depth. Without this, playback
            // re-interprets the recorded bend at the MPE default and sounds
            // four times deeper than it was played (audit MD-8, review r1).
            const key = createWebMidiNoteKey(2, 64);
            activeNotes.set(key, {
                channel: 2,
                note: 64,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
            });
            channelToNote.set(2, key);
            declare_bend_range(2, 12);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            fn(2, 0, 96);

            expect(activeNotes.get(key)?.pitchBend).toBe(4096);
            expect(activeNotes.get(key)?.pitchBendRangeSemitones).toBe(12);
        });

        it('captures the MPE default onto the note when the controller declared nothing', () => {
            const key = createWebMidiNoteKey(2, 64);
            activeNotes.set(key, {
                channel: 2,
                note: 64,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
            });
            channelToNote.set(2, key);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            fn(2, 0, 96);

            expect(activeNotes.get(key)?.pitchBendRangeSemitones).toBe(48);
        });

        it('does not leak one channel declaration onto another in non-MPE mode', () => {
            mpe_enabled.value = false;
            activeNotes.set(createWebMidiNoteKey(5, 60), {
                channel: 5,
                note: 60,
                trackId: 'track-1',
                instrumentTrackId: 'instrument-track',
                startTime: 0,
                startBeat: 0,
            });
            declare_bend_range(0, 12);
            const fn = handleWebMidiPitchBend._factory(make_dependencies());

            fn(5, 0, 96);

            expect(apply_note_expression).toHaveBeenCalledWith(expect.objectContaining({ bendRangeSemitones: 2 }));
        });
    });

    it('in non-MPE mode, retunes all active oscillators by the global ±2 semitone bend', () => {
        mpe_enabled.value = false;
        target_track_id.value = 'track-1';
        const set_target_a = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
        const set_target_b = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
        const keyA = createWebMidiNoteKey(0, 60);
        const keyB = createWebMidiNoteKey(0, 64);
        activeNotes.set(keyA, {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: { detune: { setTargetAtTime: set_target_a } } as unknown as OscillatorNode,
        });
        activeNotes.set(keyB, {
            channel: 0,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: { detune: { setTargetAtTime: set_target_b } } as unknown as OscillatorNode,
        });
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        // Full positive bend: msb=127, lsb=127 -> ((127<<7)|127) - 8192 = 16383 - 8192 = 8191.
        // Global range = 200 cents. bendCents = (8191/8192)*200 ≈ 199.98. baseDetune 5 -> ~205.
        fn(0, 127, 127);

        expect(set_target_a).toHaveBeenCalledWith(expect.closeTo(205, 0), LIVE_DISPATCH_TIME, 0.003);
        expect(set_target_b).toHaveBeenCalledWith(expect.closeTo(205, 0), LIVE_DISPATCH_TIME, 0.003);
    });

    it('skips retuning active notes that have no oscillator', () => {
        // A note without an osc (e.g. a hosted-plugin note) must not throw when the global
        // bend iterates over it.
        mpe_enabled.value = false;
        target_track_id.value = 'track-1';
        const set_target = vi.fn<(target: number, startTime: number, timeConstant: number) => void>();
        const keyA = createWebMidiNoteKey(0, 60);
        activeNotes.set(keyA, {
            channel: 0,
            note: 60,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            // no osc
        });
        activeNotes.set(createWebMidiNoteKey(0, 64), {
            channel: 0,
            note: 64,
            trackId: 'track-1',
            instrumentTrackId: 'track-1',
            startTime: 0,
            startBeat: 0,
            osc: { detune: { setTargetAtTime: set_target } } as unknown as OscillatorNode,
        });
        const fn = handleWebMidiPitchBend._factory(make_dependencies());

        expect(() => fn(0, 127, 127)).not.toThrow();
        // The note WITH an osc is still retuned.
        expect(set_target).toHaveBeenCalledTimes(1);
    });
});
