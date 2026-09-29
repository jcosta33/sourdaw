import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultTransportState,
    setGestureClockSource,
    tempoMapStore,
    transportStore,
} from '#/modules/Transport/stores';

import { createWebMidiNoteKey } from '../../../models/WebMidiTypes';
import { mapNativeMidiTimestamp } from '../../../repositories/webMidi/mapNativeMidiTimestamp';
import { resetChannelControllerState } from '../../../repositories/webMidi/resetChannelControllerState';
import { resetNativeMidiTimeAnchor } from '../../../repositories/webMidi/resetNativeMidiTimeAnchor';
import { setMpeEnabledInternal } from '../../../repositories/webMidi/setMpeEnabledInternal';
import { setTargetTrackId } from '../../../repositories/webMidi/setTargetTrackId';
import { activeNotes } from '../../../repositories/webMidi/state';

const audio_clock = vi.hoisted(() => ({ currentTime: 1.1, sampleRate: 48000 }));
const ensure_track_strip = vi.hoisted(() => vi.fn());
const apply_note_expression = vi.hoisted(() => vi.fn());

vi.mock('#/modules/AudioEngine/useCases', () => ({
    audioEngine: { context: audio_clock },
    applyNoteExpression: apply_note_expression,
    getDefaultBendRangeSemitones: () => 48,
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: () => false,
    startFaustNote: vi.fn(),
}));

vi.mock('#/modules/PluginHost/useCases', () => ({
    registerFaustDSP: vi.fn(),
    isFaustInstrumentModule: () => false,
}));

vi.mock('#/modules/Synth/useCases', () => ({
    getSynthParamsFromDevices: () => ({ detune: 0, release: 0.3 }),
    scheduleNote: vi.fn(() => null),
    scheduleKitNote: vi.fn(() => null),
    scheduleDrumKitNote: vi.fn(),
    getDrumKitDefByIndex: vi.fn(),
}));

const { handleWebMidiMessage } = await import('../handleWebMidiMessage');

/** The audio-clock instant every event in this suite resolves against. */
const NOW_SECONDS = 1.1;
/** The `performance.now()` reading paired with NOW_SECONDS. */
const NOW_MS = 1100;

let performance_now: ReturnType<typeof vi.spyOn>;
let restoreTransport: (() => void) | null = null;

function dispatch(data: number[], timeStamp?: number): Promise<void> | void {
    const event = { data: new Uint8Array(data), timeStamp } as unknown as MIDIMessageEvent;
    return handleWebMidiMessage(event);
}

function playTransport(
    overrides: Partial<{
        tempo: number;
        isLooping: boolean;
        loopStart: number;
        loopEnd: number;
        playheadPosition: number;
    }> = {}
): void {
    const previous = transportStore.value;
    transportStore.set({
        ...defaultTransportState,
        isPlaying: true,
        tempo: overrides.tempo ?? 120,
        isLooping: overrides.isLooping ?? false,
        loopStart: overrides.loopStart ?? 0,
        loopEnd: overrides.loopEnd ?? 0,
        // The playing transition's start position: the rolling epoch's own
        // origin, which the capture may never travel before.
        playheadPosition: overrides.playheadPosition ?? defaultTransportState.playheadPosition,
    });
    restoreTransport = () => {
        transportStore.set(previous);
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
    };
}

/** A transport whose cursor stands at `beat` as of the current audio instant. */
function cursorAt(beat: number): void {
    setGestureClockSource({
        getAudioTimeSeconds: () => audio_clock.currentTime,
        readNativeCursorBeats: () => beat,
    });
}

describe('event-time recording beat (#4875)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        audio_clock.currentTime = NOW_SECONDS;
        activeNotes.clear();
        resetChannelControllerState();
        resetNativeMidiTimeAnchor();
        setTargetTrackId('track-1');
        setMpeEnabledInternal(false);
        tempoMapStore.set({ changes: [] });
        ensure_track_strip.mockReset();
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
        performance_now = vi.spyOn(performance, 'now').mockReturnValue(NOW_MS);
    });

    afterEach(() => {
        restoreTransport?.();
        restoreTransport = null;
        performance_now.mockRestore();
    });

    it('records a delayed note-on at the beat of its event time, not of the callback run', async () => {
        playTransport();
        cursorAt(2.2);

        await dispatch([0x91, 60, 100], 1050);

        // 120 BPM: 50 ms before beat 2.2 is beat 2.1 — the stale capture
        // recorded 2.2, dating the note half a 16th late.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(2.1, 9);
    });

    it('integrates the tempo map between the event instant and now', async () => {
        playTransport();
        // The beat-0 anchor pins the default zone: 240 BPM above beat 5, 120
        // below. Half a second back from beat 6 is one beat at 240 plus a
        // quarter beat at 120 -> beat 4.5.
        tempoMapStore.set({
            changes: [
                { id: 't0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 't1', beat: 5, tempo: 240, curve: 'instant' },
            ],
        });
        cursorAt(6);

        await dispatch([0x91, 60, 100], 600);

        // A flat projection from the cursor would land on beat 5.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(4.5, 6);
    });

    it('places an event from before a loop wrap on the dying pass', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8 });
        // The cursor already wrapped to beat 0.2; the note was played 0.2 s
        // earlier, when the dying pass was 0.1 s from the seam.
        cursorAt(0.2);

        await dispatch([0x91, 60, 100], 900);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7.8, 9);
    });

    // #4668 — backwards travel is bounded at the rolling epoch's start: a
    // stamp older than the whole roll predates playback, so it answers the
    // start position the store holds instead of beats the transport never
    // traversed.
    it('answers a stamp older than the whole roll with the start position at 120 BPM', async () => {
        playTransport({ playheadPosition: 5 });
        // The roll began at beat 5 and the cursor has only reached 5.1 (0.05 s
        // of travel); the stamp is 0.5 s old — older than the roll itself.
        cursorAt(5.1);

        await dispatch([0x91, 60, 100], 600);

        // Unbounded backwards integration answered 4.1.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(5, 9);
    });

    it('answers a stamp older than the whole roll with the start position at 300 BPM', async () => {
        playTransport({ tempo: 300, playheadPosition: 5 });
        // 0.07 s of travel since the roll; the stamp is 0.9 s old.
        cursorAt(5.35);

        await dispatch([0x91, 60, 100], 200);

        // Unbounded backwards integration answered 0.85 — five beats per
        // second for a roll that has barely moved.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(5, 9);
    });

    it('keeps integrating a delayed stamp that stays within the roll', async () => {
        playTransport({ playheadPosition: 0 });
        cursorAt(2.2);

        // 0.5 s back from beat 2.2 is beat 1.2 — inside the roll from beat 0
        // (1.1 s of travel so far), so the epoch bound does not engage.
        await dispatch([0x91, 60, 100], 600);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(1.2, 9);
    });

    it('derives the beat from a native-mapped timestamp', async () => {
        playTransport();
        cursorAt(2.2);

        // Prime the port's clock anchor: this message waited 50 ms, the best
        // offset estimate so far. The next stamp then maps back onto our own
        // origin instead of onto the receipt instant.
        const primed = mapNativeMidiTimestamp({ timestampMicros: 1_050_000, receivedAtMs: NOW_MS });
        expect(primed).toBe(NOW_MS);
        const mapped = mapNativeMidiTimestamp({ timestampMicros: 1_000_000, receivedAtMs: NOW_MS });
        expect(mapped).toBe(1050);

        await dispatch([0x91, 60, 100], mapped);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(2.1, 9);
    });

    it('keeps the current-time fallback when no timestamp exists', async () => {
        playTransport();
        cursorAt(2.2);

        await dispatch([0x91, 60, 100]);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(2.2, 9);
    });

    it('records a member-channel expression change against the corrected onset', async () => {
        playTransport();
        setMpeEnabledInternal(true);
        cursorAt(2.2);

        await dispatch([0x91, 60, 100], 1050);
        audio_clock.currentTime = 1.2;
        performance_now.mockReturnValue(1200);
        await dispatch([0xe1, 0, 96], 1150);

        const note = activeNotes.get(createWebMidiNoteKey(1, 60));
        expect(note?.startBeat).toBeCloseTo(2.1, 9);
        // The bend landed 100 ms into the note: the trail is relative to the
        // note's own (corrected) onset, so the whole curve shares it.
        expect(note?.expressionTrails?.pitchBend?.points[0]?.offsetSeconds).toBeCloseTo(0.1, 9);
        expect(note?.pitchBend).toBe(4096);
    });
});
