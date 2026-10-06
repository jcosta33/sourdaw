import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultTransportState,
    playheadClockRef,
    playheadWrapCountRef,
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
        isPlaying: boolean;
        isLooping: boolean;
        loopStart: number;
        loopEnd: number;
        playheadPosition: number;
    }> = {}
): void {
    const previous = transportStore.value;
    transportStore.set({
        ...defaultTransportState,
        isPlaying: overrides.isPlaying ?? true,
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

/** How many wraps the roll has crossed since the epoch was written (#4668). */
function wrapsSinceEpochStart(count: number): void {
    playheadWrapCountRef.current = count;
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
        playheadWrapCountRef.current = 0;
        ensure_track_strip.mockReset();
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
        performance_now = vi.spyOn(performance, 'now').mockReturnValue(NOW_MS);
    });

    afterEach(() => {
        restoreTransport?.();
        restoreTransport = null;
        playheadWrapCountRef.current = 0;
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
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 900);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7.8, 9);
    });

    // #4875 — a roll that began strictly inside the loop has, after the first
    // wrap, a cursor BEHIND its epoch: the direct beat delta to the epoch
    // start goes negative, and the old epoch pre-check clamped every
    // same-pass event — young, genuinely-in-roll ones included — to the
    // epoch start.
    it('records a young same-pass event after a mid-loop roll start wraps', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The roll crossed the seam 0.05 s ago and sits 0.1 beats into the
        // pass; the event is 30 ms old — 0.06 beats back from the cursor.
        cursorAt(0.1);
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 1070);

        // The old direct-delta pre-check answered 7, the epoch start.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(0.04, 9);
    });

    it('records a young same-pass event on a later pass of a mid-loop roll', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // A later pass: the cursor is 6.9 beats into the region while the
        // epoch start (7) sits behind it; the event is 100 ms old.
        cursorAt(6.9);
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 1000);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(6.7, 9);
    });

    // #4875, #4668 — the seam branch is bounded by the roll's whole traversal
    // too, looping transports included: the integrated span from a mid-region
    // epoch to the seam plus the current pass's distance. A stamp older than
    // that predates playback and answers the epoch start, not a dying-pass
    // beat the transport never traversed.
    it('answers a seam-branch stamp older than the whole roll with the mid-loop epoch start', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The roll has traveled 0.55 s — the 0.5 s to the seam plus 0.05 s
        // into the pass; the stamp is 0.9 s old.
        cursorAt(0.1);
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 200);

        // The unbounded seam inversion answered 7.575.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7, 9);
    });

    // #4668 review — the seam bound divided out exactly one wrap: on a
    // multi-wrap roll it under-charged the traversal, so dying-pass stamps the
    // roll DID traverse clamped to the epoch start instead of inverting on
    // their own pass.
    it('inverts a dying-pass stamp across every wrap a multi-wrap roll traversed', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // Three wraps since the epoch: the roll is 8.55 s old (0.5 s to the
        // seam, two full passes, 0.05 s into the current one); the stamp is
        // 0.95 s old and belongs 0.9 s before the seam on the previous pass.
        cursorAt(0.1);
        wrapsSinceEpochStart(3);

        await dispatch([0x91, 60, 100], 150);

        // The one-wrap bound answered 7, the epoch start.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(6.2, 9);
    });

    // #4935 review — the seam window: between the seam instant and the arrival
    // tick that increments the count, the publisher clamps the dying-pass pair
    // at loopEnd but the capture's projection integrates past it, and the raw
    // cursor routed a dying-pass event to the direct-epoch bound — charging a
    // multi-wrap roll zero of its completed passes. A counted wrap beside a
    // cursor at or past loopEnd routes through the seam-aware bound instead.
    it('routes a seam-window projection past loopEnd through the wrap-aware seam bound', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The projector, not the engine, is the cursor: a browser build reads
        // the dying-pass pair the publisher clamped at 7.99 as of 20 ms ago.
        // The seam instant passed 15 ms ago and the arrival tick has not run,
        // so the count still reads one wrap and the projection (7.99 + 0.04
        // beats) runs past the loop end.
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS - 0.02;
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 500);

        // The direct bound answered 7, the epoch start; the arrival tick 15 ms
        // later answers 6.83 for the same event — one grain, two beats.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(6.83, 9);
    });

    // The seam-window routing keys on a COUNTED wrap: a roll that has not
    // wrapped keeps the direct-epoch bound, so a genuinely pre-roll stamp in
    // the same window still answers the epoch start.
    it('keeps a pre-roll stamp in the seam window of an un-wrapped roll on the epoch', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS - 0.02;
        // wrapsSinceEpochStart(0): a first seam whose arrival tick has not
        // run — the roll is 20 ms old and the 0.6 s stamp predates it.

        await dispatch([0x91, 60, 100], 500);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7, 9);
    });

    // #4935 review — the seam-window fingerprint is bounded by one projection
    // grain. A cursor playing STRAIGHT past a region shrunk below it mid-roll
    // (the ruler drag writes no epoch and zeroes no count) carries stale wraps
    // and stands arbitrarily far past loopEnd: that is a play-through, not a
    // seam handover, and keeps the direct epoch bound.
    it('keeps a straight pass past a region shrunk below it on the direct bound', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 4, playheadPosition: 7 });
        // The roll wrapped the old [0, 8) region three times before the ruler
        // drag; the dragged region leaves the straight cursor (9) five beats
        // past the new loop end, and the note is 100 ms old.
        cursorAt(9);
        wrapsSinceEpochStart(3);

        await dispatch([0x91, 60, 100], 1000);

        // The unbounded fingerprint answered 0, loopStart; the note belongs
        // 0.2 beats back from the straight cursor.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(8.8, 9);
    });

    // #4935 review — a loop disabled mid-roll leaves the roll's completed
    // passes in the count: the wrapped cursor below the epoch rides a pass
    // that began at loopStart, so the direct epoch bound reads a negative
    // span and clamps every event to the epoch.
    it('inverts on the current pass when the loop is disabled below the epoch', async () => {
        playTransport({ isLooping: false, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The roll ran epoch 7 to the seam, wrapped twice, and the loop was
        // turned off on the third pass; the cursor stands at 3 and the note
        // is 25 ms old — 0.05 beats at 120 BPM.
        cursorAt(3);
        wrapsSinceEpochStart(2);

        await dispatch([0x91, 60, 100], 1075);

        // The negative direct span answered 7, the epoch.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(2.95, 9);
    });

    // The disabled roll's earlier passes stay invertible too: a stamp older
    // than the current pass but within the roll's traversal sits on a pass
    // the transport DID cover while the loop was still on.
    it('inverts a disabled-loop stamp onto an earlier pass it traversed', async () => {
        playTransport({ isLooping: false, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The cursor re-entered at loopStart 0.15 s ago; the stamp is 0.5 s
        // old — 0.35 s before the last wrap, on the pass before it.
        cursorAt(0.3);
        wrapsSinceEpochStart(2);

        await dispatch([0x91, 60, 100], 600);

        // The negative direct span answered 7, the epoch.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7.3, 9);
    });

    // The disabled roll's bound is its actual traversal — epoch to the first
    // seam, every completed pass, and the current pass's distance — so a
    // stamp older than all of it still predates the roll.
    it('answers a disabled-loop stamp older than the whole traversal with the epoch', async () => {
        playTransport({ isLooping: false, loopStart: 0, loopEnd: 0.4, playheadPosition: 0.3 });
        // The roll has travelled 0.3 s — the 0.05 s to the seam, one full
        // 0.2 s pass, and 0.05 s of the current one; the stamp is 0.8 s old.
        cursorAt(0.1);
        wrapsSinceEpochStart(2);

        await dispatch([0x91, 60, 100], 300);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(0.3, 9);
    });

    // Control — a roll whose loop was already off at the epoch carries a zero
    // count beside it: the region geometry alone must not engage the
    // pass-aware bound, and the plain non-looping answers stand.
    it('keeps a plain non-looping roll on the direct epoch answers', async () => {
        playTransport({ isLooping: false, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        cursorAt(7.5);
        // wrapsSinceEpochStart stays 0: the loop was off before the roll began.

        await dispatch([0x91, 60, 100], 1050);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7.4, 9);
    });

    it('answers a plain non-looping stamp older than the roll with the epoch', async () => {
        playTransport({ isLooping: false, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // 0.25 s of travel since the epoch; the stamp is 0.9 s old.
        cursorAt(7.5);
        // wrapsSinceEpochStart stays 0.

        await dispatch([0x91, 60, 100], 200);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7, 9);
    });

    // #4668 review — the same-pass floor compared the epoch beat against the
    // cursor beat, which on a later pass reads the epoch (7) as "in this
    // pass": young events clamped to it instead of inverting within the pass.
    it('never clamps a young same-pass event on a later pass to the epoch', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The cursor is 7.5 beats into a later pass — AHEAD of the epoch
        // start's beat, which is why the cursor comparison misfires; the
        // event is 0.5 s old, well within this pass.
        cursorAt(7.5);
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 600);

        // The beat-comparison floor answered 7, the epoch start.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(6.5, 9);
    });

    // #4668 review — a roll that has not wrapped yet was charged the seam
    // re-entry anyway: the seam branch's bound added the current pass's whole
    // distance to the epoch-to-seam span, admitting dying-pass answers for
    // stamps that predate the roll itself.
    it('charges no seam re-entry to a roll that has not wrapped', async () => {
        playTransport({ isLooping: true, loopStart: 4, loopEnd: 5.9, playheadPosition: 5.5 });
        // The roll began 0.15 s ago at 5.5 and the cursor (5.8) has not
        // reached the seam; the stamp is 0.95 s old — older than the roll.
        cursorAt(5.8);

        await dispatch([0x91, 60, 100], 150);

        // The phantom re-entry answered 5.8, a dying-pass beat the roll never
        // traversed.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(5.5, 9);
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

    // #4935 review — a capture on a parked transport reads the store, never
    // the wrap count: whatever the dead roll left beside the parked epoch, a
    // stopped capture answers where the transport came to rest.
    it('answers a stopped capture from the store position, whatever count the dead roll left', async () => {
        playTransport({ isPlaying: false, playheadPosition: 4 });
        wrapsSinceEpochStart(2);

        await dispatch([0x91, 60, 100], 500);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(4, 9);
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
