/**
 * Open a pass of live MIDI over the span the session is playing (#3892).
 *
 * ── Where a pass begins, and why a loop is one span ───────────────────────
 *
 * A pass begins at the playhead, because an entry stamped behind it is counted
 * late and never delivered (`record_late_midi_notes`). A loop is the one case
 * that reaches further back: `Scheduler::frames_until_loop_end` wraps only a
 * playhead already below the region's end, so entering a region partway through
 * still plays the region entire from the first wrap on — and since the engine
 * does not consume an entry, the region sent once is the region every later
 * pass replays. So a looping pass takes the region from its start, or from the
 * playhead when the musician entered it from before, and sends the whole thing
 * here rather than windowing it.
 *
 * ── Where a non-looping pass ends, and why nowhere ────────────────────────
 *
 * It does not end. The audio programme's last playback is not this span's
 * bound: a project whose only material is MIDI schedules no playback at all,
 * and a span closed at that end would carry no note whatsoever. Every note past
 * the playhead is projected instead, and what leaves on each tick is bounded by
 * the writer's own lookahead and trail ({@link pumpNativeLiveMidiWriter}) —
 * which is the only bound that has ever decided what the store holds.
 *
 * ── Clear all, then schedule, in one batch ────────────────────────────────
 *
 * `clear-midi 0..null` wipes whatever the previous pass left in every target's
 * store. It travels in the same batch as the notes that replace it because a
 * batch is one visibility: split in two, the clear lands first and releases a
 * note the rewrite only meant to move
 * ({@link AudioGraphScheduleMidiCommand}).
 *
 * ── Before the roll, never after it ───────────────────────────────────────
 *
 * `apply_due_midi_notes` delivers nothing while the transport is stopped, and
 * an entry the playhead has already passed is dropped rather than delivered
 * late. So the batch has to be in the store before the engine starts advancing
 * — which is why this is awaited ahead of the roll rather than fired behind it,
 * and why it applies through the backend directly rather than queueing behind
 * work the caller is itself in the middle of.
 */

import { logger } from '#/infra/logger/appLogger';
import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphCommand } from '../../models/AudioGraphBackend';

import { admitMidiEvents } from './admitMidiEvents';
import { applyMidiBatch } from './applyMidiBatch';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import {
    MIDI_WINDOW_SECONDS,
    nativeLiveMidiWriter,
    type LiveMidiWriterPass,
    type LiveMidiWriterTarget,
    type MidiAdmission,
    type MidiWriterBatch,
} from './nativeLiveMidiWriterState';
import { type LiveMidiProgrammeExclusion, type LiveMidiSpan } from './projectLiveMidiProgramme';
import { readLiveMidiProgramme } from './readLiveMidiProgramme';
import { watchNativeLiveMidiEdits } from './watchNativeLiveMidiEdits';

export type ArmNativeLiveMidiWriterInput = Readonly<{
    /** The strips the session's topology built — the only ones a note may address. */
    stripTracks: readonly Track[];
    /**
     * The external plugin instances the native engine currently owns.
     *
     * The caller's, never read here, and that is the whole point: the caller
     * projected its topology against one attach state, and an instrument the
     * writer read from a *fresher* one would be voiced by neither carrier —
     * gated out of Web Audio by no batch, and sent notes by an engine whose
     * graph has no body for it.
     */
    attachedInstanceIds: ReadonlySet<string>;
    /** The frame grid this session's notes are placed on. */
    sampleRate: number;
    /** Where this pass begins, on the engine clock. */
    positionSeconds: number;
}>;

type PassSpan = LiveMidiSpan & Readonly<{ looping: boolean }>;

function passSpan(input: ArmNativeLiveMidiWriterInput): PassSpan {
    const { loopRegion, loopEnabled } = nativeLiveGraphSession;
    if (!loopEnabled || !loopRegion || input.positionSeconds >= loopRegion.endSeconds) {
        return { startSeconds: input.positionSeconds, endSeconds: Number.POSITIVE_INFINITY, looping: false };
    }
    return {
        startSeconds: Math.min(input.positionSeconds, loopRegion.startSeconds),
        endSeconds: loopRegion.endSeconds,
        looping: true,
    };
}

/**
 * The producer drops what it cannot carry so one strip cannot refuse the whole
 * batch, but a drop nobody says out loud is an instrument that stays silent
 * with no account of why. Said once per set rather than once per arm: a note
 * edit re-arms, and repeating an unchanged list buries the change when the set
 * does move.
 */
function reportExclusions(exclusions: readonly LiveMidiProgrammeExclusion[]): void {
    const lines = exclusions.map(
        (exclusion) => `[AudioEngine] live MIDI excluded strip ${exclusion.stripId}: ${exclusion.reason}`
    );
    const signature = lines.join('\n');
    if (signature === nativeLiveMidiWriter.reportedExclusions) {
        return;
    }
    nativeLiveMidiWriter.reportedExclusions = signature;
    for (const line of lines) {
        logger.warn(line);
    }
}

/** The opening batch: every target's store wiped, then filled to the horizon. */
function openingBatch(pass: LiveMidiWriterPass, positionSeconds: number): MidiWriterBatch {
    // A looping pass is sent whole: the wrap replays what the store already
    // holds, and windowing inside a region would need a behind-clear that
    // deletes exactly what the next wrap is going to play.
    const horizonSeconds = pass.looping ? Number.POSITIVE_INFINITY : positionSeconds + MIDI_WINDOW_SECONDS;
    const commands: AudioGraphCommand[] = [];
    const admissions: MidiAdmission[] = [];
    for (const slot of pass.targets) {
        // Cleared even when nothing is admitted: this target's store may hold
        // the previous pass's notes while this one owes it none.
        commands.push({ kind: 'clear-midi', target: slot.target, fromTime: 0, toTime: null });
        const admitted = admitMidiEvents(slot, { horizonSeconds, heldAfterClear: 0 });
        if (admitted > 0) {
            commands.push({
                kind: 'schedule-midi',
                target: slot.target,
                probabilitySeed: pass.probabilitySeed,
                notes: slot.events.slice(slot.cursor, slot.cursor + admitted),
            });
        }
        admissions.push({ slot, admitted, heldAfter: admitted });
    }
    return { commands, admissions };
}

export async function armNativeLiveMidiWriter(input: ArmNativeLiveMidiWriterInput): Promise<void> {
    const span = passSpan(input);
    const programme = readLiveMidiProgramme({
        stripTracks: input.stripTracks,
        attachedInstanceIds: input.attachedInstanceIds,
        sampleRate: input.sampleRate,
        span,
    });
    reportExclusions(programme.exclusions);

    const trackNameById = new Map(input.stripTracks.map((track): [string, string] => [track.id, track.name]));
    nativeLiveMidiWriter.epoch += 1;
    // Any arm answers a re-read the outgoing pass owed: this one re-projects
    // every strip's notes, so a request still standing would re-arm again for
    // an edit this pass already carries.
    nativeLiveMidiWriter.pendingRearm = false;
    const pass: LiveMidiWriterPass = {
        stripTracks: input.stripTracks,
        sampleRate: input.sampleRate,
        probabilitySeed: programme.probabilitySeed,
        entrySeconds: input.positionSeconds,
        looping: span.looping,
        loopRegion: span.looping ? nativeLiveGraphSession.loopRegion : null,
        // The opening batch wipes each store whole, so the trail starts at the
        // head of the timeline and walks forward from there.
        lastClearedBeforeSeconds: 0,
        refusalReported: false,
        targets: programme.targets.map((entry): LiveMidiWriterTarget => {
            const device = input.stripTracks
                .find((track) => track.id === entry.target.trackId)
                ?.devices.find((candidate) => candidate.id === entry.target.deviceId);
            return {
                target: entry.target,
                deviceName: device?.name ?? entry.target.deviceId,
                trackName: trackNameById.get(entry.target.trackId) ?? entry.target.trackId,
                events: entry.events,
                cursor: 0,
                held: 0,
                saturationReported: false,
            };
        }),
    };
    nativeLiveMidiWriter.pass = pass;
    // For the life of the pass: a note edited under a rolling playhead has to
    // reach the store the engine is reading from.
    watchNativeLiveMidiEdits();

    await applyMidiBatch({
        pass,
        batch: openingBatch(pass, input.positionSeconds),
        epoch: nativeLiveMidiWriter.epoch,
    });
}
