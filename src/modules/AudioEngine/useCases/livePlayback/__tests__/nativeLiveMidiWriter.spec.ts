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
    events: [] as { time: number; note: number }[],
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
                .filter((entry) => entry.time >= input.span.startSeconds && entry.time < input.span.endSeconds)
                .map((entry): AudioGraphMidiNoteEvent => ({
                    time: entry.time,
                    note: entry.note,
                    velocity: 100,
                    channel: 0,
                    isNoteOn: true,
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

    // The engine replays a region from the entries it already holds, so the
    // region goes out whole and a behind-clear would delete exactly what the
    // next wrap is going to play.
    it('sends a looping region whole at arm and pumps nothing inside it', async () => {
        mocks.events = lane(200);
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 12, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;

        await arm(0);

        // The whole region, not a lookahead's worth of it: the wrap replays
        // these entries with no help from this side.
        expect(scheduledIn(0)).toHaveLength(mocks.events.filter((entry) => entry.time < 12).length);
        expect(scheduledIn(0).length).toBeGreaterThan(MIDI_WINDOW_SECONDS * 10);

        await pump(6, 0);
        await pump(1, 1);
        expect(batches()).toHaveLength(1);
    });

    // `frames_until_loop_end` wraps a playhead already below the region's end,
    // so entering a region partway through still plays the region entire from
    // the first wrap on. A pass that began at the playhead would leave the
    // region's head empty for every wrap after that.
    it('takes a looping pass from the region start when the playhead entered it partway through', async () => {
        mocks.events = [
            { time: 2, note: 60 },
            { time: 9, note: 62 },
        ];
        nativeLiveGraphSession.loopRegion = { startSeconds: 0, endSeconds: 12, enabled: true };
        nativeLiveGraphSession.loopEnabled = true;

        await arm(6);

        expect(scheduledIn(0).map((event) => event.time)).toEqual([2, 9]);
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
        const secondBatchDeviceIds = (batches()[2]?.commands ?? []).map((command) => command.target.deviceId);
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
        const afterDrop = batches()
            .slice(1)
            .flatMap((batch) => batch.commands)
            .map((command) => command.target.deviceId);
        expect(afterDrop).not.toContain('plug');

        // A further arm with the same targets: the owed entry was forgotten,
        // not merely skipped once, so nothing revives a clear naming it.
        await arm(0);

        const afterSecondArm = batches()
            .slice(1)
            .flatMap((batch) => batch.commands)
            .map((command) => command.target.deviceId);
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
        const deviceIds = batches()
            .slice(1)
            .flatMap((batch) => batch.commands)
            .map((command) => command.target.deviceId);
        expect(deviceIds).not.toContain('plug');
    });
});
