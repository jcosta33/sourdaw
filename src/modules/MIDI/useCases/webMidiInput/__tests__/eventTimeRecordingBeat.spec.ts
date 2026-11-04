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
    audioEngine: { context: audio_clock, ensureTrackStrip: ensure_track_strip },
    applyNoteExpression: apply_note_expression,
    getDefaultBendRangeSemitones: () => 48,
    getCompensationDelay: () => 0,
    getFactoryDrumKitByIndex: () => null,
    isDeviceCarriedByNativeSession: () => false,
    sendNativeLiveMidiControl: async () => true,
    sendNativeLiveMidiNote: async () => true,
    soundsNativeNotes: () => false,
    startFaustNote: vi.fn(),
    writeNativeBuiltinParameters: vi.fn(),
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
        playheadClockRef.hold = null;
        playheadClockRef.pendingLoopSeam = null;
        ensure_track_strip.mockReset();
        ensure_track_strip.mockReturnValue({ gainNode: {}, deviceNodes: [] });
        performance_now = vi.spyOn(performance, 'now').mockReturnValue(NOW_MS);
    });

    afterEach(() => {
        restoreTransport?.();
        restoreTransport = null;
        playheadWrapCountRef.current = 0;
        playheadClockRef.hold = null;
        playheadClockRef.pendingLoopSeam = null;
        performance_now.mockRestore();
    });

    it.each([0, 2])('keeps current and delayed incoming events exact before arrival on wrap %i', async (wraps) => {
        const shift = wraps * 4;
        audio_clock.currentTime = NOW_SECONDS + shift;
        performance_now.mockReturnValue(NOW_MS + shift * 1000);
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 6 });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS + shift - 0.02;
        playheadClockRef.pendingLoopSeam = {
            generation: playheadClockRef.generation,
            anchorBeat: playheadClockRef.beat,
            anchorAudioTimeSeconds: playheadClockRef.audioTimeSeconds,
            tempo: transportStore.value!.tempo,
            tempoMapChanges: tempoMapStore.value?.changes ?? null,
            audioTimeSeconds: 1.085 + shift,
            loopStart: 0,
            loopEnd: 8,
            passIndex: wraps + 1,
        };
        wrapsSinceEpochStart(wraps);
        await dispatch([0x91, 60, 100], 1100 + shift * 1000);
        await dispatch([0x91, 62, 100], 1095 + shift * 1000);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))).toMatchObject({ recordingPassIndex: wraps + 1 });
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(0.03, 9);
        expect(activeNotes.get(createWebMidiNoteKey(1, 62))?.recordingPassIndex).toBe(wraps + 1);
        expect(activeNotes.get(createWebMidiNoteKey(1, 62))?.startBeat).toBeCloseTo(0.02, 9);
        playheadClockRef.pendingLoopSeam = null;
        playheadClockRef.beat = 0.04;
        playheadClockRef.audioTimeSeconds = 1.105 + shift;
        audio_clock.currentTime = 1.105 + shift;
        performance_now.mockReturnValue(1105 + shift * 1000);
        wrapsSinceEpochStart(wraps + 1);
        await dispatch([0x91, 64, 100], 1100 + shift * 1000);
        expect(activeNotes.get(createWebMidiNoteKey(1, 64))?.recordingPassIndex).toBe(wraps + 1);
        expect(activeNotes.get(createWebMidiNoteKey(1, 64))?.startBeat).toBeCloseTo(0.03, 9);
    });

    it('integrates the incoming tempo map from the emitted seam without quantizing its offset', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 6 });
        tempoMapStore.set({
            changes: [
                { id: 'head', beat: 0, tempo: 120, curve: 'instant' },
                { id: 'tail', beat: 0.01, tempo: 60, curve: 'instant' },
            ],
        });
        audio_clock.currentTime = 5.1;
        performance_now.mockReturnValue(5100);
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = 5.08;
        playheadClockRef.pendingLoopSeam = {
            generation: playheadClockRef.generation,
            anchorBeat: 7.99,
            anchorAudioTimeSeconds: 5.08,
            tempo: 120,
            tempoMapChanges: tempoMapStore.value?.changes ?? null,
            audioTimeSeconds: 5.09,
            loopStart: 0,
            loopEnd: 8,
            passIndex: 1,
        };
        await dispatch([0x91, 60, 100], 5100);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(0.015, 9);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.recordingPassIndex).toBe(1);
    });

    it('keeps the epoch floor on the first witnessed seam', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = 1.08;
        playheadClockRef.pendingLoopSeam = {
            generation: playheadClockRef.generation,
            anchorBeat: 7.99,
            anchorAudioTimeSeconds: 1.08,
            tempo: 120,
            tempoMapChanges: tempoMapStore.value?.changes ?? null,
            audioTimeSeconds: 1.085,
            loopStart: 0,
            loopEnd: 8,
            passIndex: 1,
        };
        await dispatch([0x91, 60, 100], 500);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBe(7);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.recordingPassIndex).toBe(0);
    });

    it('does not consume an obsolete pending boundary after the loop region changes', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 4, playheadPosition: 6 });
        cursorAt(8.03);
        playheadClockRef.pendingLoopSeam = {
            generation: playheadClockRef.generation,
            anchorBeat: playheadClockRef.beat,
            anchorAudioTimeSeconds: playheadClockRef.audioTimeSeconds,
            tempo: transportStore.value!.tempo,
            tempoMapChanges: tempoMapStore.value?.changes ?? null,
            audioTimeSeconds: 1.085,
            loopStart: 0,
            loopEnd: 8,
            passIndex: 1,
        };
        await dispatch([0x91, 60, 100], 1100);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.recordingPassIndex).toBe(0);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBe(8.03);
    });

    it('records a delayed note-on at the beat of its event time, not of the callback run', async () => {
        playTransport();
        cursorAt(2.2);

        await dispatch([0x91, 60, 100], 1050);

        // 120 BPM: 50 ms before beat 2.2 is beat 2.1 — the stale capture
        // recorded 2.2, dating the note half a 16th late.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(2.1, 9);
    });

    it('holds a delayed physical onset at the requested Play beat while admission spans a tempo switch', async () => {
        playTransport({ isLooping: true, loopStart: 4, loopEnd: 12, playheadPosition: 8 });
        tempoMapStore.set({
            changes: [
                { id: 'old-tempo', beat: 0, tempo: 300, curve: 'instant' },
                { id: 'held-tempo', beat: 4, tempo: 60, curve: 'instant' },
            ],
        });
        playheadClockRef.beat = 0;
        playheadClockRef.audioTimeSeconds = 0;
        playheadClockRef.hold = { generation: 12, beat: 8 };
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        await dispatch([0x91, 60, 100], 1000);
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBe(8);
        expect(ensure_track_strip).toHaveBeenCalledExactlyOnceWith('track-1');
        expect(playheadWrapCountRef.current).toBe(0);
        expect(playheadClockRef.beat).toBe(0);
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
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.recordingPassIndex).toBe(2);
    });

    // #4935 review — the seam window: between the seam instant and the arrival
    // tick that increments the count, the publisher clamps the dying-pass pair
    // at loopEnd. A raw projection past it routed a dying-pass event to the
    // direct-epoch bound — charging a multi-wrap roll zero of its completed
    // passes. The capture folds the projection at the seam and counts that
    // seam beside the published wraps, so the event inverts around the loop.
    it('routes a seam-window projection past loopEnd through the wrap-aware seam bound', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The projector, not the engine, is the cursor: a browser build reads
        // the dying-pass pair the publisher clamped at 7.99 as of 20 ms ago.
        // The seam instant passed 15 ms ago and the arrival tick has not run,
        // so the count still reads one wrap; the capture folds the projection
        // (7.99 + 0.04 beats) to 0.03 on the next pass.
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

    // #4935 review — the seam is dated by the projection's own travel to
    // loopEnd, never by a re-integration through the post-seam map: a change
    // just past loopEnd sits in a zone a looping roll never travels, and
    // charging the overshoot to it turned 0.095 s of projection into 0.445 s
    // of "travel" — enough to route the seam band's events to the direct
    // bound's never-played beats.
    it('admits the seam window past a post-seam tempo change for a grain-young event', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // 120 BPM with an instant drop to 20 at 8.05: the overshoot zone is
        // six times slower than the anchor that produced it.
        tempoMapStore.set({
            changes: [
                { id: 't0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 't1', beat: 8.05, tempo: 20, curve: 'instant' },
            ],
        });
        // The dying-pass pair stands at 7.99 as of 0.1 s ago; the projection
        // (7.99 + 0.2 beats at the anchor tempo) runs 0.19 beats past the seam,
        // whose post-seam integral reads 0.445 s.
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS - 0.1;
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 1050);

        // The direct bound answered 8.17, a beat past the seam the roll never
        // played. The capture folds the projection at the seam, 0.005 s after
        // the anchor at its own 120 BPM, so the transport wrapped 0.095 s ago
        // and the 50 ms event sits 0.045 s into the incoming pass: beat 0.09,
        // at its own offset rather than stacked on the pass origin.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(0.09, 9);
    });

    // #4935 review — same window, older event: the 400 ms stamp predates the
    // seam (which the transport crossed 0.095 s ago), so it belongs on the dying
    // pass, 0.305 s before it: beat 7.39 (truth 7.4). The post-seam
    // integration charged the stamp's whole age to the 20 BPM zone and
    // answered 8.06 instead.
    it('inverts a pre-seam stamp onto the dying pass across a post-seam tempo change', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        tempoMapStore.set({
            changes: [
                { id: 't0', beat: 0, tempo: 120, curve: 'instant' },
                { id: 't1', beat: 8.05, tempo: 20, curve: 'instant' },
            ],
        });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS - 0.1;
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 700);

        // The direct bound answered 8.06.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7.39, 9);
    });

    // A main-thread stall delayed the tick that would count the seam: the
    // anchor (beat 3 of a [0, 4) loop) is 0.8 s old and no seam was emitted.
    // The transport crossed loopEnd 0.3 s ago, so an event 0.2 s old sits
    // 0.1 s into the next pass at its own offset, and one 0.5 s old is on the
    // dying pass, 0.2 s before the seam.
    it.each([0, 2])('dates events around a seam a stall left uncounted (%i wraps counted)', async (wraps) => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 4, playheadPosition: 0 });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 3;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS - 0.8;
        wrapsSinceEpochStart(wraps);

        await dispatch([0x91, 60, 100], 900);
        await dispatch([0x91, 62, 100], 600);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))).toMatchObject({
            startBeat: expect.closeTo(0.2, 9),
            recordingPassIndex: wraps + 1,
        });
        expect(activeNotes.get(createWebMidiNoteKey(1, 62))).toMatchObject({
            startBeat: expect.closeTo(3.6, 9),
            recordingPassIndex: wraps,
        });
    });

    // Control — the same geometry without the post-seam change: the flat map
    // makes the old post-seam integral and the anchor-tempo conversion agree
    // exactly, so the admission, the incoming distance, and the dying-pass
    // answer stand unchanged.
    it('keeps the constant-tempo seam window on the same dying-pass answer', async () => {
        playTransport({ isLooping: true, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        setGestureClockSource({
            getAudioTimeSeconds: () => audio_clock.currentTime,
            readNativeCursorBeats: () => null,
        });
        playheadClockRef.beat = 7.99;
        playheadClockRef.audioTimeSeconds = NOW_SECONDS - 0.1;
        wrapsSinceEpochStart(1);

        await dispatch([0x91, 60, 100], 700);

        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(7.39, 9);
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

    // #4935 review — the disabled roll's line does not stop at the seam:
    // turned off mid-pass, the cursor kept playing straight past the last
    // loopEnd it crossed, and the motion from loopStart through the cursor is
    // one continuous line over the same map, so the wrap-aware traversal
    // covers this shape too. The direct epoch-to-cursor span charged none of
    // the completed passes.
    it('inverts a stamp on a disabled roll that played straight past loopEnd', async () => {
        playTransport({ tempo: 300, isLooping: false, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        // The roll ran epoch 7 over the seam, wrapped twice, and the loop was
        // turned off on the third pass; the cursor kept playing straight to 9.
        // The note is 600 ms old — 3 beats at 300 BPM — and beat 6 sits on
        // that straight line.
        cursorAt(9);
        wrapsSinceEpochStart(2);

        await dispatch([0x91, 60, 100], 500);

        // The direct span (7 -> 9 = 0.4 s of travel) answered 7, the epoch.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(6, 9);
    });

    // Control — a plain never-looping roll carries a zero count beside the
    // same shape: its `wrapsSinceEpoch <= 0` branch answers the same straight
    // epoch-to-cursor line the direct bound does, byte-identically.
    it('keeps a never-looped roll past loopEnd on the direct epoch answers', async () => {
        playTransport({ isLooping: false, loopStart: 0, loopEnd: 8, playheadPosition: 7 });
        cursorAt(9);
        // wrapsSinceEpochStart stays 0: the loop was off before the roll began.

        await dispatch([0x91, 60, 100], 1000);

        // 100 ms old — 0.2 beats back from 9 at 120 BPM.
        expect(activeNotes.get(createWebMidiNoteKey(1, 60))?.startBeat).toBeCloseTo(8.8, 9);
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
