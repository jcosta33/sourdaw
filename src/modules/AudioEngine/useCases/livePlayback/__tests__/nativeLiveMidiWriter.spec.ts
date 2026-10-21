/**
 * What the live MIDI writer sends the engine, and when (#3892).
 *
 * The double is `readLiveMidiProgramme`, the one place the producer binds to
 * the stores. The projection's own laws — placement, overlap, the chance roll,
 * the exclusions — are proven where they live
 * (`projectLiveMidiProgramme.spec.ts`). What is proven here is everything
 * downstream of the notes: which of them leave on which tick, what the store's
 * capacity costs, what the trail gives back, and what a loop, a locate, an edit
 * and a stale epoch do to the cursor.
 *
 * The engine's own rules the batches are read against: an entry is addressed by
 * absolute frame and never consumed, so nothing but a `clear-midi` frees a
 * slot; a store holds `MIDI_NOTE_STORE_CAPACITY` entries per plugin; and an
 * entry behind the playhead at scheduling time is counted late and never
 * delivered.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    type AudioGraphApplyResult,
    type AudioGraphBackend,
    type AudioGraphClearMidiCommand,
    type AudioGraphCommand,
    type AudioGraphCommandBatch,
    type AudioGraphMidiNoteEvent,
    type AudioGraphScheduleMidiCommand,
} from '../../../models/AudioGraphBackend';
import { type EngineTransportPosition } from '../../../models/EngineTransportPosition';
import { armNativeLiveMidiWriter } from '../armNativeLiveMidiWriter';
import { disarmNativeLiveMidiWriter } from '../disarmNativeLiveMidiWriter';
import { nativeEnginePlayheadFeed, pollNativeEnginePlayheadOnce } from '../nativeEnginePlayheadFeedState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import {
    MIDI_NOTE_STORE_CAPACITY,
    MIDI_TRAIL_SECONDS,
    MIDI_WINDOW_SECONDS,
    nativeLiveMidiWriter,
} from '../nativeLiveMidiWriterState';
import { pumpNativeLiveMidiWriter } from '../pumpNativeLiveMidiWriter';
import { repositionNativeLiveGraphSession } from '../repositionNativeLiveGraphSession';
import { requestNativeLiveMidiWriterRearm } from '../requestNativeLiveMidiWriterRearm';

const SAMPLE_RATE = 48_000;
const TARGET = { trackId: 'midi-1', deviceId: 'd1' } as const;

const mocks = vi.hoisted(() => ({
    /** What every read of the programme answers, as the arm would receive it. */
    events: [] as { time: number; note: number; isNoteOn?: boolean; noteOnTime?: number }[],
    exclusions: [] as { stripId: string; reason: string }[],
    /** The targets the programme reports, reassignable per test to move a sink between arms. */
    targets: [] as { trackId: string; deviceId: string }[],
    apply: vi.fn<(batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult>>(),
    readPosition: vi.fn<() => Promise<EngineTransportPosition>>(),
    warn: vi.fn<(message: string, ...rest: unknown[]) => void>(),
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: { error: vi.fn(), warn: mocks.warn, info: vi.fn(), debug: vi.fn() },
}));
vi.mock('../../../repositories/engineTransport/getEngineTransportPosition', () => ({
    getEngineTransportPosition: () => mocks.readPosition(),
}));
vi.mock('../readLiveMidiProgramme', () => ({
    // Span-aware, because the span is half of what an arm decides: a producer
    // that answered the same notes whatever span it was handed would make a
    // locate indistinguishable from a no-op, and would hand the engine entries
    // behind its own playhead — which it counts late and never delivers.
    readLiveMidiProgramme: (input: { span: { startSeconds: number; endSeconds: number } }) => ({
        targets: mocks.targets.map((target) => ({
            target,
            events: mocks.events
                .filter((entry) => {
                    const onset = entry.noteOnTime ?? entry.time;
                    return onset >= input.span.startSeconds && onset < input.span.endSeconds;
                })
                .map((entry): AudioGraphMidiNoteEvent => ({
                    time: entry.time,
                    note: entry.note,
                    velocity: 100,
                    channel: 0,
                    isNoteOn: entry.isNoteOn ?? true,
                })),
        })),
        exclusions: mocks.exclusions,
        nativeVoicedStripIds: new Set(mocks.targets.map((target) => target.trackId)),
        probabilitySeed: 7,
    }),
}));

const APPLIED: AudioGraphApplyResult = {
    acceptance: 'accepted',
    application: 'applied',
    runtimeRevision: 1,
    reports: [],
};

const REFUSED: AudioGraphApplyResult = {
    acceptance: 'rejected',
    application: 'not-applied',
    reason: 'midi-note-store-capacity — this plugin’s note store is full',
};

const backend: AudioGraphBackend = {
    backendId: 'midi-writer-spec',
    apply: (batch) => mocks.apply(batch),
    dispose: () => undefined,
};

/** Note-ons one tenth of a second apart, which is the grid every case reads. */
function lane(count: number, startSeconds = 0, stepSeconds = 0.1): { time: number; note: number }[] {
    return Array.from({ length: count }, (_unused, index) => ({
        time: startSeconds + index * stepSeconds,
        note: 60 + (index % 12),
    }));
}

/** Each note has its own onset and release; identities also distinguish equal pitches. */
function pairedLane(
    count: number,
    start: number,
    duration: number
): { time: number; note: number; isNoteOn: boolean; noteOnTime?: number }[] {
    return Array.from({ length: count }, (_, index) => [
        { time: start + ((index + 0.2) * duration) / count, note: 60 + (index % 12), isNoteOn: true },
        { time: start + ((index + 0.6) * duration) / count, note: 60 + (index % 12), isNoteOn: false },
    ]).flat();
}

function eventIdentities(events: readonly { time: number; note: number; isNoteOn?: boolean }[]): string[] {
    return events.map((event) => `${Math.round(event.time * SAMPLE_RATE)}:${event.note}:${event.isNoteOn ?? true}`);
}

/** Persistent native semantics: a clear frees capacity, rendering never consumes an entry. */
function persistentMidiSink(initialPosition = 0) {
    let position = initialPosition;
    let stored: AudioGraphMidiNoteEvent[] = [];
    let maximumHeld = 0;
    let maximumRequested = 0;
    let refusals = 0;
    const delivered: string[] = [];
    const sounding = new Set<number>();
    const releases: number[] = [];
    mocks.apply.mockImplementation(async (batch) => {
        const region = nativeLiveGraphSession.loopRegion;
        const requiredNext = stored.filter((event) => {
            let distance = event.time - position;
            if (distance < 0) {
                distance = Infinity;
                if (region) {
                    distance = region.endSeconds - position + event.time - region.startSeconds;
                }
            }
            return distance >= 0 && distance < 0.25;
        });
        let next = [...stored];
        let scheduled = false;
        const stripped = new Set<number>();
        for (const command of batch.commands) {
            if (command.kind === 'clear-midi') {
                expect(scheduled).toBe(false);
                const from = Math.round(command.fromTime * SAMPLE_RATE);
                const to = command.toTime === null ? Infinity : Math.round(command.toTime * SAMPLE_RATE);
                next = next.filter((event) => {
                    const frame = Math.round(event.time * SAMPLE_RATE);
                    if (frame >= from && frame < to && !event.isNoteOn && sounding.has(event.note)) {
                        stripped.add(event.note);
                    }
                    return frame < from || frame >= to;
                });
            }
            if (command.kind === 'schedule-midi') {
                scheduled = true;
                const frames = command.notes.map((event) => Math.round(event.time * SAMPLE_RATE));
                expect(frames).toEqual([...frames].sort((left, right) => left - right));
                maximumRequested = Math.max(maximumRequested, command.notes.length);
                if (next.length + command.notes.length > MIDI_NOTE_STORE_CAPACITY) {
                    refusals += 1;
                    return REFUSED;
                }
                const held = new Set(eventIdentities(next));
                expect(eventIdentities(command.notes).filter((identity) => held.has(identity))).toEqual([]);
                next.push(...command.notes);
            }
        }
        const after = new Set(eventIdentities(next));
        expect(eventIdentities(requiredNext).filter((identity) => !after.has(identity))).toEqual([]);
        // Native merge keeps an already-stored event before an arriving event
        // at the same frame; it does not reorder ties into note-off first.
        stored = next.sort((left, right) => left.time - right.time);
        // Native clear_midi_notes records only removed offs. Settlement reads
        // the first future event of that key after the entire rewrite batch.
        for (const note of stripped) {
            const first = stored.find((event) => event.note === note && event.time >= position);
            if (!first || first.isNoteOn) {
                sounding.delete(note);
                releases.push(note);
            }
        }
        maximumHeld = Math.max(maximumHeld, stored.length);
        return APPLIED;
    });
    return {
        delivered,
        held: () => stored.length,
        maximumHeld: () => maximumHeld,
        maximumRequested: () => maximumRequested,
        refusals: () => refusals,
        sounding: (note: number) => sounding.has(note),
        releases,
        render: (from: number, to: number) => {
            const first = Math.round(from * SAMPLE_RATE);
            const end = Math.round(to * SAMPLE_RATE);
            position =
                to === nativeLiveGraphSession.loopRegion?.endSeconds
                    ? nativeLiveGraphSession.loopRegion.startSeconds
                    : to;
            const due = stored.filter((event) => {
                const frame = Math.round(event.time * SAMPLE_RATE);
                return frame >= first && frame < end;
            });
            delivered.push(...eventIdentities(due));
            for (const event of due) {
                if (event.isNoteOn) {
                    sounding.add(event.note);
                } else {
                    sounding.delete(event.note);
                    releases.push(event.note);
                }
            }
            if (to === nativeLiveGraphSession.loopRegion?.endSeconds) {
                releases.push(...sounding);
                sounding.clear();
            }
        },
    };
}

function batches(): AudioGraphCommandBatch[] {
    return mocks.apply.mock.calls.map(([batch]) => batch);
}

function scheduledIn(index: number): AudioGraphMidiNoteEvent[] {
    return (batches()[index]?.commands ?? [])
        .filter((command): command is AudioGraphScheduleMidiCommand => command.kind === 'schedule-midi')
        .flatMap((command) => command.notes);
}

function clearsIn(index: number): AudioGraphClearMidiCommand[] {
    return (batches()[index]?.commands ?? []).filter(
        (command): command is AudioGraphClearMidiCommand => command.kind === 'clear-midi'
    );
}

/** The device every MIDI command in these batches names; nothing else ever travels in a writer batch. */
function deviceIdsNamedIn(commands: readonly AudioGraphCommand[]): string[] {
    return commands
        .filter(
            (command): command is AudioGraphClearMidiCommand | AudioGraphScheduleMidiCommand =>
                command.kind === 'clear-midi' || command.kind === 'schedule-midi'
        )
        .map((command) => command.target.deviceId);
}

/** A macrotask, which drains the microtasks an apply's round trip settles on. */
function flush(): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, 0));
}

async function arm(positionSeconds: number): Promise<void> {
    await armNativeLiveMidiWriter({
        stripTracks: [],
        attachedInstanceIds: new Set(),
        carriedStripIds: new Set([TARGET.trackId]),
        sampleRate: SAMPLE_RATE,
        positionSeconds,
    });
}

async function pump(positionSeconds: number, loopWraps = 0): Promise<void> {
    await pumpNativeLiveMidiWriter({
        positionSeconds,
        loopWraps,
        writerEpoch: nativeLiveMidiWriter.epoch,
    });
    await flush();
}

/** One turn of the animation-frame feed, which is what takes a pending re-read. */
async function poll(positionSeconds: number): Promise<void> {
    mocks.readPosition.mockResolvedValue({
        running: true,
        playing: true,
        positionSeconds,
        playheadFrame: Math.round(positionSeconds * SAMPLE_RATE),
        loopWraps: 0,
        batchesApplied: 1,
        tempo: 120,
        timeSigNum: 4,
        timeSigDenom: 4,
        masterPeak: 0,
        stripPeaks: {},
        tunerTelemetry: {},
    });
    nativeEnginePlayheadFeed.inFlightEpoch = null;
    pollNativeEnginePlayheadOnce();
    await flush();
}

beforeEach(() => {
    mocks.apply.mockReset();
    mocks.apply.mockResolvedValue(APPLIED);
    mocks.readPosition.mockReset();
    mocks.warn.mockClear();
    mocks.events = [];
    mocks.exclusions = [];
    mocks.targets = [TARGET];
    disarmNativeLiveMidiWriter();
    nativeEnginePlayheadFeed.running = true;
    nativeEnginePlayheadFeed.epoch += 1;
    nativeEnginePlayheadFeed.inFlightEpoch = null;
    nativeEnginePlayheadFeed.reading = null;
    nativeLiveGraphSession.backend = backend;
    nativeLiveGraphSession.rolling = true;
    nativeLiveGraphSession.loopRegion = null;
    nativeLiveGraphSession.loopEnabled = false;
    nativeLiveGraphSession.pending = Promise.resolve();
    // Leaked between cases otherwise: the record a chain edit installs is
    // read by every arm, and a stale entry from one case would answer the
    // next case's abandoned-target check.
    nativeLiveGraphSession.nativeChainByStripId = new Map();
});

describe('the live MIDI writer', () => {
    // One batch, because a clear and the notes that replace it are one
    // visibility: split in two, the clear lands alone and releases a key the
    // rewrite only meant to move.
    it('opens a pass by clearing each store whole and filling it to the lookahead', async () => {
        mocks.events = lane(80);

        await arm(0);

        expect(batches()).toHaveLength(1);
        expect(clearsIn(0)).toEqual([{ kind: 'clear-midi', target: TARGET, fromTime: 0, toTime: null }]);
        const sent = scheduledIn(0);
        expect(sent).toHaveLength(MIDI_WINDOW_SECONDS * 10);
        expect(sent.at(-1)?.time).toBeCloseTo(MIDI_WINDOW_SECONDS - 0.1, 10);
        expect(batches()[0]?.commands[0]?.kind).toBe('clear-midi');
    });

    // A project whose only material is MIDI schedules no audio playback at all,
    // so the audio programme it is played beside ends at zero. A note span
    // closed there would carry nothing whatsoever: what bounds a non-looping
    // pass is this writer's own lookahead and trail, not the last clip the
    // engine plays as samples.
    it('reaches every note past the playhead when the project schedules no audio at all', async () => {
        mocks.events = [
            { time: 0, note: 60 },
            { time: 30, note: 62 },
        ];

        await arm(0);

        expect(scheduledIn(0).map((event) => event.time)).toEqual([0]);

        await pump(28);

        expect(scheduledIn(1).map((event) => event.time)).toEqual([30]);
    });

    // The refusal is whole-batch, so a store shorter than the take stops at a
    // bar the musician can hear ending and nothing else reports it.
    it('admits only what the store holds and says once how much of the part fits', async () => {
        // A span wholly inside the lookahead, so capacity rather than the
        // horizon is what ends the run.
        mocks.events = lane(MIDI_NOTE_STORE_CAPACITY + 10, 0, 0.000_5);

        await arm(0);

        expect(scheduledIn(0)).toHaveLength(MIDI_NOTE_STORE_CAPACITY);
        expect(mocks.warn).toHaveBeenCalledTimes(1);
        expect(mocks.warn).toHaveBeenCalledWith(
            `[AudioEngine] plugin "d1" on "midi-1" holds ${MIDI_NOTE_STORE_CAPACITY} of ${MIDI_NOTE_STORE_CAPACITY + 10} scheduled notes; the engine store is full`
        );
    });

    // The cursor is a claim that the engine accepted those events, so the same
    // position twice owes nothing: re-sending would put a second copy of every
    // note in a store that never consumed the first.
    it('extends the window past the playhead and sends nothing for a position it already covered', async () => {
        mocks.events = lane(120);

        await arm(0);
        const opening = scheduledIn(0).length;

        await pump(1);
        expect(scheduledIn(1).map((event) => event.time)).toEqual(
            mocks.events.slice(opening, opening + 10).map((entry) => entry.time)
        );

        await pump(1);
        expect(batches()).toHaveLength(2);
    });

    // Capacity is finite and a pass is not, so what the playhead has left has
    // to go. The margin is the safety on that: the echoed position is a frame
    // or two behind the engine's own, and a clear that reached the true
    // playhead would delete a note about to be delivered.
    it('gives the spent trail back once it has grown past a second of store', async () => {
        mocks.events = lane(200);

        await arm(0);
        await pump(1);
        // The trail is still inside the margin, so it is not worth a command.
        expect(clearsIn(1)).toEqual([]);

        const position = MIDI_TRAIL_SECONDS + 1.5;
        const heldBefore = nativeLiveMidiWriter.pass?.targets[0]?.held ?? 0;
        await pump(position);

        expect(clearsIn(2)).toEqual([
            { kind: 'clear-midi', target: TARGET, fromTime: 0, toTime: position - MIDI_TRAIL_SECONDS },
        ]);
        expect(nativeLiveMidiWriter.pass?.lastClearedBeforeSeconds).toBeCloseTo(position - MIDI_TRAIL_SECONDS, 10);
        const cleared = mocks.events.filter((entry) => entry.time < position - MIDI_TRAIL_SECONDS).length;
        expect(nativeLiveMidiWriter.pass?.targets[0]?.held).toBe(heldBefore + scheduledIn(2).length - cleared);
    });

    // A refused batch pushes nothing, so a cursor moved by one would step over
    // notes the engine never took and never send them again.
    it('leaves the cursor and the trail where they were when the engine refuses', async () => {
        mocks.events = lane(200);

        await arm(0);
        const cursorBefore = nativeLiveMidiWriter.pass?.targets[0]?.cursor ?? 0;

        mocks.apply.mockResolvedValueOnce(REFUSED);
        await pump(MIDI_TRAIL_SECONDS + 1.5);

        expect(nativeLiveMidiWriter.pass?.targets[0]?.cursor).toBe(cursorBefore);
        expect(nativeLiveMidiWriter.pass?.lastClearedBeforeSeconds).toBe(0);
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('live MIDI batch refused'));
    });

    it.each([3, 12])(
        'delivers all 1200 paired notes for three passes of a %s-second loop within store capacity',
        async (duration) => {
            mocks.events = pairedLane(1200, 0, duration);
            nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: duration, enabled: true };
            nativeLiveGraphSession.loopEnabled = true;
            const sink = persistentMidiSink();

            await arm(0);
            expect(sink.held()).toBeLessThan(MIDI_NOTE_STORE_CAPACITY);
            for (let wrap = 0; wrap < 3; wrap += 1) {
                for (let tick = 0; tick < 60; tick += 1) {
                    const from = (duration * tick) / 60;
                    // Delay one poll by ten ordinary ticks, still inside the
                    // adaptive horizon. Rendering continues through that gap.
                    if (duration === 3 && tick === 10) {
                        tick += 9;
                    }
                    const to = (duration * (tick + 1)) / 60;
                    sink.render(from, to);
                    await pump(to === duration ? 0 : to, to === duration ? wrap + 1 : wrap);
                }
                expect(sink.delivered.splice(0)).toEqual(eventIdentities(mocks.events));
            }
            expect(sink.maximumRequested()).toBeLessThanOrEqual(MIDI_NOTE_STORE_CAPACITY);
            expect(sink.maximumHeld()).toBeLessThanOrEqual(MIDI_NOTE_STORE_CAPACITY);
            expect(sink.refusals()).toBe(0);
            expect(mocks.warn).not.toHaveBeenCalled();
        }
    );

    it('retains a prefetched head while clearing the tail and refilling across a nonzero loop seam', async () => {
        mocks.events = pairedLane(1200, 2, 3);
        nativeLiveGraphSession.loopRegion = { startSeconds: 2, endSeconds: 5, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink(4);
        await arm(4);
        for (let wrap = 0; wrap < 3; wrap += 1) {
            const start = wrap === 0 ? 4 : 2;
            for (let position = start; position < 5; position += 0.125) {
                sink.render(position, position + 0.125);
                await pump(position + 0.125 === 5 ? 2 : position + 0.125, position + 0.125 === 5 ? wrap + 1 : wrap);
            }
            expect(sink.delivered.splice(0)).toEqual(
                eventIdentities(mocks.events.filter((event) => event.time >= start))
            );
        }
        expect(sink.refusals()).toBe(0);
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('replays a short region without duplicating persistent entries on repeated or skipped-wrap readings', async () => {
        mocks.events = pairedLane(20, 2, 1);
        nativeLiveGraphSession.loopRegion = { startSeconds: 2, endSeconds: 3, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        await pump(2.25, 7);
        const held = sink.held();
        await pump(2.25, 7);
        await pump(2.5, 9);
        expect(sink.held()).toBe(held);
        sink.render(2, 3);
        expect(sink.delivered).toEqual(eventIdentities(mocks.events));
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('reserves a real off beyond the seam for deletion before the native wrap releases the key', async () => {
        mocks.events = [
            { time: 2.75, note: 60 },
            { time: 3.25, note: 60, isNoteOn: false, noteOnTime: 2.75 },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 2, endSeconds: 3, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink(2.5);
        await arm(2.5);
        sink.render(2.5, 2.9);
        expect(sink.sounding(60)).toBe(true);
        mocks.events = [];
        requestNativeLiveMidiWriterRearm();
        await poll(2.9);
        expect(sink.sounding(60)).toBe(false);
        sink.render(2.9, 3);
        expect(sink.releases).toEqual([60]);
    });

    it('releases exactly once at each seam while reserving a real off beyond it', async () => {
        mocks.events = [
            { time: 2.75, note: 60 },
            { time: 3.25, note: 60, isNoteOn: false, noteOnTime: 2.75 },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 2, endSeconds: 3, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink(2);
        await arm(2);
        for (let wrap = 0; wrap < 3; wrap += 1) {
            sink.render(2, 2.9);
            expect(sink.sounding(60)).toBe(true);
            sink.render(2.9, 3);
            expect(sink.sounding(60)).toBe(false);
            expect(sink.releases).toHaveLength(wrap + 1);
            await pump(2, wrap + 1);
        }
        expect(sink.maximumHeld()).toBe(2);
        expect(sink.refusals()).toBe(0);
    });

    it('keeps loop residency and the trail floor unchanged after a refused batch or a superseded answer', async () => {
        mocks.events = pairedLane(1200, 2, 3);
        nativeLiveGraphSession.loopRegion = { startSeconds: 2, endSeconds: 5, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        await arm(2);
        await pump(3.5, 0);
        const pass = nativeLiveMidiWriter.pass;
        expect(pass).not.toBeNull();
        const held = pass?.targets[0]?.heldEventIndices;
        const floor = pass?.lastClearedBeforeSeconds;
        const wraps = pass?.lastLoopWraps;
        mocks.apply.mockResolvedValueOnce(REFUSED);
        await pump(2, 1);
        expect(pass?.targets[0]?.heldEventIndices).toBe(held);
        expect(pass?.lastClearedBeforeSeconds).toBe(floor);
        expect(pass?.lastLoopWraps).toBe(wraps);

        let settle: ((value: AudioGraphApplyResult) => void) | undefined;
        mocks.apply.mockImplementationOnce(
            () =>
                new Promise((resolve) => {
                    settle = resolve;
                })
        );
        const stale = pump(2, 1);
        expect(settle).toBeDefined();
        await arm(4);
        const successor = nativeLiveMidiWriter.pass;
        const successorHeld = successor?.targets[0]?.heldEventIndices;
        settle?.(APPLIED);
        await stale;
        expect(pass?.targets[0]?.heldEventIndices).toBe(held);
        expect(pass?.lastClearedBeforeSeconds).toBe(floor);
        expect(successor?.targets[0]?.heldEventIndices).toBe(successorHeld);
        expect(successor?.lastLoopWraps).toBeNull();
    });

    it('resets the trail floor when a wrap counter advances even when the sampled position advances too', async () => {
        mocks.events = pairedLane(1200, 2, 3);
        nativeLiveGraphSession.loopRegion = { startSeconds: 2, endSeconds: 5, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        await arm(2);
        await pump(3.5, 0);
        expect(nativeLiveMidiWriter.pass?.lastClearedBeforeSeconds).toBeGreaterThan(2);
        await pump(3.75, 2);
        expect(nativeLiveMidiWriter.pass?.lastLoopWraps).toBe(2);
        expect(nativeLiveMidiWriter.pass?.targets[0]?.held).toBeLessThanOrEqual(MIDI_NOTE_STORE_CAPACITY);
        await pump(2, 3);
        expect(nativeLiveMidiWriter.pass?.lastClearedBeforeSeconds).toBe(2);
    });

    it('bounds stable-window source and index visits by store capacity instead of the immutable loop length', async () => {
        const pairs = 100_000;
        const duration = pairs / 27.8;
        mocks.events = pairedLane(pairs, 0, duration);
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: duration, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const position = duration / 2;
        await arm(position);
        await pump(position, 0);
        const slot = nativeLiveMidiWriter.pass?.targets[0];
        if (!slot) {
            throw new Error('the real arm must produce a target before measuring its prepared window');
        }
        let visits = 0;
        // Count actual indexed reads of the score, resident entries and any
        // prepared frame index. Preparation has already completed through arm.
        for (const [key, value] of Object.entries(slot)) {
            if (Array.isArray(value)) {
                Reflect.set(
                    slot,
                    key,
                    new Proxy(value, {
                        get(target, property, receiver) {
                            if (typeof property === 'string' && /^\d+$/.test(property)) {
                                visits += 1;
                            }
                            return Reflect.get(target, property, receiver);
                        },
                    })
                );
            }
        }
        const preparedIndex = slot.loopFrameGroups;
        await pump(position + 1 / 60, 0);
        expect(slot.loopFrameGroups).toBe(preparedIndex);
        console.info(`Loop MIDI stable-window visits: ${visits} for ${slot.events.length} source entries`);
        // At most two capacity-bounded source passes, three ahead/trail index
        // passes and resident bookkeeping, plus logarithmic position lookups.
        const bound = 8 * MIDI_NOTE_STORE_CAPACITY + 4 * Math.ceil(Math.log2(slot.events.length + 1));
        expect(visits).toBeLessThanOrEqual(bound);
        expect(slot.held).toBeLessThanOrEqual(MIDI_NOTE_STORE_CAPACITY);
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it.each(['delete', 'reattack'] as const)(
        'releases a sounding long note on %s when its old distant off was never resident',
        async (edit) => {
            mocks.events = [
                { time: 1, note: 60, isNoteOn: true },
                { time: 3, note: 64, isNoteOn: true },
                { time: 3.5, note: 64, isNoteOn: false },
                { time: 15, note: 60, isNoteOn: false },
            ];
            nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 20, enabled: true };
            nativeLiveGraphSession.loopEnabled = true;
            const sink = persistentMidiSink();
            await arm(0);
            sink.render(0, 2);
            expect(sink.sounding(60)).toBe(true);
            mocks.events = mocks.events.filter((event) => event.note !== 60);
            if (edit === 'reattack') {
                mocks.events.push({ time: 4, note: 60, isNoteOn: true }, { time: 4.5, note: 60, isNoteOn: false });
            }
            requestNativeLiveMidiWriterRearm();
            await poll(2);
            expect(sink.sounding(60)).toBe(false);
            expect(sink.releases.filter((note) => note === 60)).toEqual([60]);
            sink.render(2, 4.25);
            expect(sink.sounding(60)).toBe(edit === 'reattack');
            sink.render(4.25, 5);
            expect(sink.sounding(60)).toBe(false);
        }
    );

    it.each([15, 18])('preserves a still-live long note through a rewrite ending at %ss', async (end) => {
        mocks.events = [
            { time: 1, note: 60, isNoteOn: true },
            { time: 3, note: 64, isNoteOn: true },
            { time: 3.5, note: 64, isNoteOn: false },
            { time: 15, note: 60, isNoteOn: false },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 20, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        sink.render(0, 2);
        mocks.events = mocks.events.map((event) => {
            if (event.note === 60) {
                return { ...event, time: event.isNoteOn ? 0.5 : end };
            }
            return event;
        });
        requestNativeLiveMidiWriterRearm();
        await poll(2);
        expect(sink.sounding(60)).toBe(true);
        expect(sink.releases).not.toContain(60);
        for (let position = 2; position < end; position += 0.25) {
            if (position === 8) {
                // The old on is now outside the spent trail. An unrelated
                // rewrite must still find its real off and preserve the key.
                requestNativeLiveMidiWriterRearm();
                await poll(position);
                expect(sink.releases).not.toContain(60);
            }
            await pump(position, 0);
            sink.render(position, Math.min(position + 0.25, end));
            expect(sink.sounding(60)).toBe(true);
        }
        sink.render(end, end + 0.25);
        expect(sink.sounding(60)).toBe(false);
        expect(sink.releases.filter((note) => note === 60)).toEqual([60]);
    });

    it('keeps a reserved off before a later same-frame reattack without preloading that attack', async () => {
        mocks.events = [
            { time: 0.1, note: 60, isNoteOn: true },
            { time: 8, note: 60, isNoteOn: false },
            { time: 8, note: 60, isNoteOn: true },
            { time: 8.5, note: 60, isNoteOn: false },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 12, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        expect(scheduledIn(0).map((event) => [event.time, event.isNoteOn])).toEqual([
            [0.1, true],
            [8, false],
        ]);
        for (let position = 0; position < 8.5; position += 0.25) {
            await pump(position, 0);
            sink.render(position, position + 0.25);
            if (position >= 0.25) {
                expect(sink.sounding(60)).toBe(true);
            }
        }
        sink.render(8.5, 8.75);
        expect(sink.sounding(60)).toBe(false);
        expect(sink.delivered).toEqual(eventIdentities(mocks.events));
        expect(sink.releases).toEqual([60, 60]);
        expect(sink.maximumHeld()).toBeLessThanOrEqual(MIDI_NOTE_STORE_CAPACITY);
        expect(sink.refusals()).toBe(0);
    });

    it('delivers contiguous same-frame off/on pairs across wraps within capacity', async () => {
        mocks.events = Array.from({ length: 1200 }, (_unused, index) => [
            { time: 1 + index / 100, note: 60, isNoteOn: true },
            { time: 1 + (index + 1) / 100, note: 60, isNoteOn: false },
        ])
            .flat()
            .sort((left, right) => left.time - right.time || Number(left.isNoteOn) - Number(right.isNoteOn));
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 14, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        for (let wrap = 0; wrap < 3; wrap += 1) {
            for (let position = 0; position < 14; position += 0.25) {
                sink.render(position, position + 0.25);
                await pump(position + 0.25 === 14 ? 0 : position + 0.25, position + 0.25 === 14 ? wrap + 1 : wrap);
            }
            expect(sink.delivered.splice(0)).toEqual(eventIdentities(mocks.events));
            expect(sink.sounding(60)).toBe(false);
        }
        expect(sink.maximumHeld()).toBeLessThanOrEqual(MIDI_NOTE_STORE_CAPACITY);
        expect(sink.refusals()).toBe(0);
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('preserves a reserved off when wrap cleanup clears its frame neighbour', async () => {
        mocks.events = [
            { time: 0.1, note: 60, isNoteOn: true },
            { time: 8, note: 60, isNoteOn: false },
            { time: 8, note: 70, isNoteOn: true },
            { time: 8.5, note: 70, isNoteOn: false },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 12, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        sink.render(0, 4.25);
        await pump(4.25, 0);
        sink.render(4.25, 12);
        await pump(0, 1);
        sink.render(0, 0.5);
        expect(sink.sounding(60)).toBe(true);
        mocks.events = mocks.events.filter((event) => event.note !== 60);
        requestNativeLiveMidiWriterRearm();
        await poll(0.5);
        expect(sink.sounding(60)).toBe(false);
        expect(sink.releases.filter((note) => note === 60)).toEqual([60, 60]);
        expect(sink.refusals()).toBe(0);
    });

    it('keeps a rejected opening uncommitted and releases the deleted key when a later arm applies', async () => {
        mocks.events = [
            { time: 1, note: 60, isNoteOn: true },
            { time: 3, note: 64, isNoteOn: true },
            { time: 3.5, note: 64, isNoteOn: false },
            { time: 15, note: 60, isNoteOn: false },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 20, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        sink.render(0, 2);
        mocks.events = mocks.events.filter((event) => event.note !== 60);
        mocks.apply.mockResolvedValueOnce(REFUSED);
        await arm(2);
        expect(sink.sounding(60)).toBe(true);
        expect(nativeLiveMidiWriter.pass?.targets[0]?.held).toBe(0);
        expect(nativeLiveMidiWriter.pass?.targets[0]?.heldEventIndices).toEqual([]);
        await arm(2);
        expect(sink.sounding(60)).toBe(false);
        expect(sink.releases).toEqual([60]);
    });

    it('releases a long key when its target is abandoned before its distant off', async () => {
        mocks.events = [
            { time: 1, note: 60, isNoteOn: true },
            { time: 15, note: 60, isNoteOn: false },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 20, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        const sink = persistentMidiSink();
        await arm(0);
        sink.render(0, 2);
        mocks.targets = [];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['d1']]]);
        await arm(2);
        expect(sink.sounding(60)).toBe(false);
        expect(sink.releases).toEqual([60]);
        expect(nativeLiveMidiWriter.owedClears.size).toBe(0);
    });

    it('replaces the prepared loop index when a note edit rearms the pass', async () => {
        mocks.events = pairedLane(20, 0, 3);
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 3, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        await arm(0);
        const original = nativeLiveMidiWriter.pass?.targets[0]?.loopFrameGroups;
        expect(original).toHaveLength(40);
        mocks.events = pairedLane(32, 0, 3);
        requestNativeLiveMidiWriterRearm();
        await poll(0.25);
        const replacement = nativeLiveMidiWriter.pass?.targets[0]?.loopFrameGroups;
        expect(replacement).not.toBe(original);
        expect(replacement).toHaveLength(64);
        expect(nativeLiveMidiWriter.pass?.targets[0]?.events).toHaveLength(64);
    });

    it('keeps whole equal-frame groups at the adaptive cutoff', async () => {
        mocks.events = [...lane(1000, 0, 0.0005), ...lane(600, 0.75, 0)];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 3, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        await arm(0);
        expect(scheduledIn(0).filter((event) => event.time === 0.75)).toHaveLength(600);
        expect(scheduledIn(0)).toHaveLength(1600);
        await pump(0.5);
        expect(mocks.warn).not.toHaveBeenCalled();
    });

    it('reports an unrepresentable same-frame group instead of silently keeping only a prefix', async () => {
        mocks.events = lane(MIDI_NOTE_STORE_CAPACITY + 1, 0.5, 0);
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 3, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;
        await arm(0);
        expect(scheduledIn(0)).toEqual([]);
        expect(mocks.warn).toHaveBeenCalledWith(expect.stringContaining('same frame'));
    });

    // A locate moves the playhead out of the window this pass filled, and the
    // engine drops an entry the playhead has passed rather than delivering it
    // late — so the whole store is rewritten from the new position.
    it('rewrites every store from the new position when the transport is located', async () => {
        mocks.events = lane(200);

        await arm(0);
        await repositionNativeLiveGraphSession({ positionSeconds: 9 });
        await flush();

        // The locate's own `set-transport` batch, then the rewrite.
        const rewrite = batches().length - 1;
        expect(clearsIn(rewrite)).toEqual([{ kind: 'clear-midi', target: TARGET, fromTime: 0, toTime: null }]);
        const sent = scheduledIn(rewrite);
        expect(sent[0]?.time).toBeCloseTo(9, 10);
        expect(sent.at(-1)?.time).toBeLessThan(9 + MIDI_WINDOW_SECONDS);
    });

    // A note edited under a rolling playhead has to reach the store the engine
    // is reading from; the request is recorded and the next reading takes it,
    // which coalesces a musician's drag into one re-arm.
    it('answers a burst of note edits with one rewrite on the next reading', async () => {
        mocks.events = lane(200);

        await arm(0);
        requestNativeLiveMidiWriterRearm();
        requestNativeLiveMidiWriterRearm();
        expect(nativeLiveMidiWriter.pendingRearm).toBe(true);

        await poll(1);

        expect(nativeLiveMidiWriter.pendingRearm).toBe(false);
        // One rewrite, not one per request, and no window extension behind it:
        // the arm's own batch is the answer to the reading.
        expect(batches()).toHaveLength(2);
        expect(clearsIn(1)).toEqual([{ kind: 'clear-midi', target: TARGET, fromTime: 0, toTime: null }]);
        expect(scheduledIn(1)[0]?.time).toBeCloseTo(1, 10);
    });

    // A batch can outlive the pass that issued it, and a stop, a seek or a note
    // edit ends one while a round trip is still out.
    it('sends nothing for a pass the writer has already replaced', async () => {
        mocks.events = lane(200);

        await arm(0);
        const staleEpoch = nativeLiveMidiWriter.epoch;
        await arm(0);

        await pumpNativeLiveMidiWriter({ positionSeconds: 1, loopWraps: 0, writerEpoch: staleEpoch });
        await flush();

        expect(batches()).toHaveLength(2);
    });

    // A chain edit can move a strip's sink between one arm and the next: an
    // instrument inserted ahead of another takes over as the note carrier, and
    // the device it displaced keeps whatever the outgoing pass left in its
    // store unless something clears it — the part would otherwise sound on
    // both. The clear for it is owed rather than folded into the incoming
    // pass's own opening batch: the pass that named it is already gone by the
    // time this arm runs, so it travels in its own batch ahead of the one that
    // clears and refills what the incoming pass actually names.
    it('clears the store of a target the outgoing pass held and the incoming one drops', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(5);

        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm', 'plug']]]);

        await arm(0);

        expect(batches()[1]?.commands).toEqual([
            { kind: 'clear-midi', target: { trackId: 'midi-1', deviceId: 'plug' }, fromTime: 0, toTime: null },
        ]);
        expect(clearsIn(2)).toEqual([
            { kind: 'clear-midi', target: { trackId: 'midi-1', deviceId: 'ferm' }, fromTime: 0, toTime: null },
        ]);
        const secondBatchDeviceIds = deviceIdsNamedIn(batches()[2]?.commands ?? []);
        expect(secondBatchDeviceIds).not.toContain('plug');
        const scheduleCommands = (batches()[2]?.commands ?? []).filter(
            (command): command is AudioGraphScheduleMidiCommand => command.kind === 'schedule-midi'
        );
        expect(scheduleCommands.map((command) => command.target.deviceId)).toEqual(['ferm']);
        expect(scheduleCommands.flatMap((command) => command.notes).length).toBeGreaterThan(0);
    });

    // A device the chain edit also removed is one `graph.rs` no longer holds a
    // strip slot for: naming it in a `clear-midi` refuses the whole batch, so
    // the abandoned-target clear must skip exactly what the removal already
    // accounts for — and, once skipped, it stays skipped rather than being
    // retried forever by every later arm.
    it('leaves a dropped target alone when the engine no longer holds its device', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(5);

        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm']]]);

        await arm(0);

        // From the second arm on: the first arm's own batch legitimately
        // names plug, since plug was the live target when it was sent.
        const afterDrop = deviceIdsNamedIn(
            batches()
                .slice(1)
                .flatMap((batch) => batch.commands)
        );
        expect(afterDrop).not.toContain('plug');

        // A further arm with the same targets: the owed entry was forgotten,
        // not merely skipped once, so nothing revives a clear naming it.
        await arm(0);

        const afterSecondArm = deviceIdsNamedIn(
            batches()
                .slice(1)
                .flatMap((batch) => batch.commands)
        );
        expect(afterSecondArm).not.toContain('plug');
    });

    // A refusal answers only for the batch it was sent on: the pass that owed
    // the clear is gone, so the entry has to survive the refusal and come back
    // on the next arm, or a chain edit that briefly finds the engine busy
    // would abandon the store for good.
    it('re-issues an owed clear the engine refused', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(5);

        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm', 'plug']]]);
        mocks.apply.mockResolvedValueOnce(REFUSED);

        await arm(0);

        expect(batches()[1]?.commands).toEqual([
            { kind: 'clear-midi', target: { trackId: 'midi-1', deviceId: 'plug' }, fromTime: 0, toTime: null },
        ]);

        // Unchanged targets: nothing about this arm renews the abandonment,
        // but the earlier refusal left the entry owed, and this arm is the
        // retry.
        await arm(0);

        expect(batches()[3]?.commands).toEqual([
            { kind: 'clear-midi', target: { trackId: 'midi-1', deviceId: 'plug' }, fromTime: 0, toTime: null },
        ]);

        // That retry applied, so a further arm owes nothing more for it.
        await arm(0);

        // From the second arm on: the first arm's own opening batch
        // legitimately clears plug too, since plug was its own live target.
        const plugClears = batches()
            .slice(1)
            .flatMap((batch) => batch.commands)
            .filter((command) => command.kind === 'clear-midi' && command.target.deviceId === 'plug');
        expect(plugClears).toHaveLength(2);
    });

    // The owed clear and the incoming pass's own opening batch are the two
    // things a chain edit produces, and they must not share a fate: an owed
    // clear naming a device the engine happens to refuse at that instant must
    // not cost the incoming pass its own clear and notes.
    it('a refused owed clear does not take the opening batch with it', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(5);

        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm', 'plug']]]);
        mocks.apply.mockResolvedValueOnce(REFUSED);

        await arm(0);

        expect(clearsIn(2)).toEqual([
            { kind: 'clear-midi', target: { trackId: 'midi-1', deviceId: 'ferm' }, fromTime: 0, toTime: null },
        ]);
        expect(scheduledIn(2).length).toBeGreaterThan(0);
        expect(nativeLiveMidiWriter.pass?.targets[0]?.cursor).toBeGreaterThan(0);
    });

    // `readNativeChain` returning `undefined` says the session built no such
    // strip at all — stronger than a chain that merely no longer lists the
    // device — and an owed clear addressed to a strip this gone must be
    // forgotten exactly the same way, not kept alive by a fallback that reads
    // an absent record as still naming the device.
    it('forgets an owed clear once the chain record drops its device', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(5);

        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        // The strip itself is gone from the record, not merely missing this
        // one device.
        nativeLiveGraphSession.nativeChainByStripId = new Map();

        await arm(0);

        // From the second arm on: the first arm's own batch legitimately
        // names plug, since plug was the live target when it was sent.
        const deviceIds = deviceIdsNamedIn(
            batches()
                .slice(1)
                .flatMap((batch) => batch.commands)
        );
        expect(deviceIds).not.toContain('plug');
    });

    // The settle this arm awaits can suspend across an arm that supersedes it
    // entirely. `applyMidiBatch` already refuses to advance a stale pass's
    // cursors, but the opening batch is sent before that guard runs — so the
    // arm itself has to know its epoch moved and never send the batch at all.
    it('sends no opening batch when a newer arm supersedes it during the settle', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(100);

        await arm(0);

        // ferm displaces plug: a clear for plug is owed from here on.
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm', 'plug']]]);

        // The first arm's own owed-clear send is held open across a second
        // arm that runs to completion while it is still out.
        let releaseFirstSettle: ((result: AudioGraphApplyResult) => void) | undefined;
        mocks.apply.mockImplementationOnce(
            () =>
                new Promise<AudioGraphApplyResult>((resolve) => {
                    releaseFirstSettle = resolve;
                })
        );
        const first = arm(0);
        await Promise.resolve();

        // A locate lands on another stack entirely while the first arm's
        // settle is still out, at a position the first arm never named.
        await arm(4);

        releaseFirstSettle?.(APPLIED);
        await first;

        // Exactly one opening batch carrying ferm's schedule: the second
        // arm's, at position 4. The first arm's own opening batch — built
        // against position 0, the pre-locate position — never went out.
        const fermSchedules = batches()
            .flatMap((batch) => batch.commands)
            .filter(
                (command): command is AudioGraphScheduleMidiCommand =>
                    command.kind === 'schedule-midi' && command.target.deviceId === 'ferm'
            );
        expect(fermSchedules).toHaveLength(1);
        expect(fermSchedules[0]?.notes.every((note) => note.time >= 4)).toBe(true);

        // The cursor reflects only the second arm's own admission; the
        // superseded first arm never touched its own pass's cursor because it
        // never reached its opening batch.
        expect(nativeLiveMidiWriter.pass?.targets[0]?.cursor).toBe(fermSchedules[0]?.notes.length);

        // Nothing sent after the second arm's opening batch.
        const openingBatchIndex = batches().findIndex((batch) =>
            batch.commands.some((command) => command.kind === 'schedule-midi' && command.target.deviceId === 'ferm')
        );
        expect(openingBatchIndex).toBe(batches().length - 1);
    });

    // A settle's reply is only as good as the epoch it was sent for. Two
    // settles can be out for the same owed entry at once — an older one held
    // open by the engine, a newer one that ran to completion — and whichever
    // reply lands under the epoch that is current at the time decides the
    // entry, never a reply that merely says "applied".
    it('leaves an owed clear standing when the epoch moved during its round trip', async () => {
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        mocks.events = lane(100);

        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm', 'plug']]]);

        // The first arm's settle is held open; a second arm runs its own
        // settle for the same owed entry to completion before it resolves.
        let releaseFirstSettle: ((result: AudioGraphApplyResult) => void) | undefined;
        mocks.apply.mockImplementationOnce(
            () =>
                new Promise<AudioGraphApplyResult>((resolve) => {
                    releaseFirstSettle = resolve;
                })
        );
        const first = arm(0);
        await Promise.resolve();

        await arm(0);
        // Discharged already, by the second arm's own reply — the only one
        // that landed under a current epoch so far.
        expect(nativeLiveMidiWriter.owedClears.size).toBe(0);

        releaseFirstSettle?.(APPLIED);
        await first;

        // The newer arm's own settle discharged the debt; the older reply finds
        // nothing left to decide.
        expect(nativeLiveMidiWriter.owedClears.size).toBe(0);

        // Invert: this time the newer settle is the one the engine refuses,
        // and the older, stale settle is the one that later resolves applied.
        // Nobody may discharge the entry on the strength of a reply sent for
        // an epoch that is no longer current.
        disarmNativeLiveMidiWriter();
        mocks.targets = [{ trackId: 'midi-1', deviceId: 'plug' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map();
        await arm(0);

        mocks.targets = [{ trackId: 'midi-1', deviceId: 'ferm' }];
        nativeLiveGraphSession.nativeChainByStripId = new Map([['midi-1', ['ferm', 'plug']]]);

        let releaseOlderSettle: ((result: AudioGraphApplyResult) => void) | undefined;
        mocks.apply.mockImplementationOnce(
            () =>
                new Promise<AudioGraphApplyResult>((resolve) => {
                    releaseOlderSettle = resolve;
                })
        );
        const stale = arm(0);
        await Promise.resolve();

        mocks.apply.mockResolvedValueOnce(REFUSED);
        await arm(0);
        expect(nativeLiveMidiWriter.owedClears.size).toBe(1);

        releaseOlderSettle?.(APPLIED);
        await stale;

        // Still owed: the applied reply belonged to a superseded epoch, and
        // the current epoch's own settle was the one the engine refused.
        expect(nativeLiveMidiWriter.owedClears.size).toBe(1);

        const beforeThirdArm = batches().length;
        await arm(0);

        expect(batches()[beforeThirdArm]?.commands).toEqual([
            { kind: 'clear-midi', target: { trackId: 'midi-1', deviceId: 'plug' }, fromTime: 0, toTime: null },
        ]);
    });
});
