/**
 * The notes each natively voiced instrument plays over one span (#3892).
 *
 * `projectLiveGraphProgramme` says what a strip *plays* as samples; this says
 * what it plays as notes. The two are separate producers because the engine
 * takes them through different commands — `schedule-clip` against a strip,
 * `schedule-midi` against the one device holding a note store — and because
 * only this half has to be re-read as the musician edits notes under a rolling
 * playhead.
 *
 * ── One arithmetic, shared with the export ────────────────────────────────
 *
 * Every number here comes from the offline renderer's own projection: the same
 * comped clip set (`resolveTrackClipsWithComping`), the same loop expansion
 * (`projectClipLoopExpansion`), the same occurrence count
 * (`getSourceOccurrenceOffset`), the same groove and offset projector at phase
 * `'complete'`, the same chord-track transposition, and the same beat-to-second
 * law `projectLiveGraphProgramme` places clips with. A second copy of any of
 * them is how a take stops sounding the same in the browser, in the bounce and
 * through the engine.
 *
 * ── The probability roll is decided here ──────────────────────────────────
 *
 * The wire can carry a chance note and let the engine roll it, but the Web and
 * offline carriers roll it on this side — so a note the browser drops and the
 * engine keeps is one arrangement voiced two ways. This producer therefore
 * rolls the chance itself, emits only what survives, and sends no probability
 * at all: the events it writes are the decision, not the odds. The roll is the
 * composition root's own, taken as a value like every other projector here,
 * because MIDI's use cases already reach back into this module's barrel and
 * calling one directly would close that loop.
 *
 * ── Overlap, because the engine holds one bit per key ─────────────────────
 *
 * The engine's sounding set is one bit per (channel, note), so two overlapping
 * notes at one pitch cannot both sound and the second note-off would release a
 * key the first already released. The common DAW rendering is to end the
 * earlier note just before the later one starts, and that is what happens here
 * — one frame before, on the pass's own grid, and the earlier note is dropped
 * outright when that would end it at or before its own start.
 */

import { type Track } from '#/modules/Arrangement/stores';
import { type MidiStoreState } from '#/modules/MIDI/stores';
import { projectClipLoopExpansion } from '#/utils/clipLoopProjection';

import { type AudioGraphDeviceTarget, type AudioGraphMidiNoteEvent } from '../../models/AudioGraphBackend';
import {
    type OfflineChordPitchProjector,
    type OfflineMidiEventProjector,
    type OfflineMidiProbabilitySelector,
} from '../../repositories/offlineScheduler/offlineMidiEventProjectorState';
import { type OfflinePpqEndpointProjector } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getSourceOccurrenceOffset } from '../offlineRender/getSourceOccurrenceOffset';
import { resolveTrackClipsWithComping, type ResolvedClip } from '../offlineRender/resolveTrackClipsWithComping';

import { nativeMidiNoteSink } from './nativeMidiNoteSink';

/** The lowest velocity a sounding note may carry; `0` is a release on the wire. */
const MIN_NOTE_ON_VELOCITY = 1;
const MAX_NOTE_VELOCITY = 127;

export type LiveMidiProgrammeTarget = Readonly<{
    target: AudioGraphDeviceTarget;
    /** Ascending by time, note-offs before note-ons at equal time. */
    events: readonly AudioGraphMidiNoteEvent[];
}>;

export type LiveMidiProgrammeExclusion = Readonly<{ stripId: string; reason: string }>;

export type LiveMidiProgramme = Readonly<{
    targets: readonly LiveMidiProgrammeTarget[];
    /** Everything this projection could not carry, and why. */
    exclusions: readonly LiveMidiProgrammeExclusion[];
    /** The strips whose notes the engine takes, whether or not they had any. */
    nativeVoicedStripIds: ReadonlySet<string>;
}>;

/** The stretch of the engine clock this projection covers, half-open. */
export type LiveMidiSpan = Readonly<{ startSeconds: number; endSeconds: number }>;

export type LiveMidiProgrammeInput = Readonly<{
    /** Every track and bus the session builds a strip for, in project order. */
    stripTracks: readonly Track[];
    /** The external plugin instances the native engine currently owns. */
    attachedInstanceIds: ReadonlySet<string>;
    /** The strips whose device chain the audio programme replaces with a bake. */
    bakedStripIds: ReadonlySet<string>;
    /**
     * The strips the topology batch built with `contributesAudio: true` — the
     * only strips the engine sounds, so the only strips a note may address.
     */
    carriedStripIds: ReadonlySet<string>;
    notesByClipId: MidiStoreState['notesByClipId'];
    /** `midiStore`'s own seed — what every carrier rolls a chance note with. */
    probabilitySeed: number;
    defaultTempo: number;
    /** The frame grid the span and the overlap trim are measured on. */
    sampleRate: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    /** The groove, offset and loop projector the offline renderer uses. */
    projectMidiEvents: OfflineMidiEventProjector;
    /** The chance roll the browser and the bounce decide a note with. */
    selectProbability: OfflineMidiProbabilitySelector;
    /**
     * The chord track's transposition, or `null` when the composition root has
     * configured none. Null conforms nothing, which is what a project with no
     * chord track means.
     */
    projectChordPitch: OfflineChordPitchProjector | null;
    span: LiveMidiSpan;
}>;

/** One projected note, before it becomes a note-on and a note-off. */
type ProjectedNote = {
    onSeconds: number;
    offSeconds: number;
    note: number;
    channel: number;
    velocity: number;
};

function clampVelocity(velocity: number): number {
    if (!Number.isFinite(velocity)) {
        return MIN_NOTE_ON_VELOCITY;
    }
    return Math.max(MIN_NOTE_ON_VELOCITY, Math.min(MAX_NOTE_VELOCITY, Math.round(velocity)));
}

/**
 * Resolve the same-key overlaps one instrument cannot sound.
 *
 * Walked back to front from each new note rather than pairwise, because ending
 * one note can drop it entirely and expose the note before it to the same
 * overlap.
 */
function resolveSameKeyOverlaps(notes: readonly ProjectedNote[], frameSeconds: number): ProjectedNote[] {
    const ordered = [...notes].sort((left, right) => left.onSeconds - right.onSeconds);
    const kept: ProjectedNote[] = [];
    for (const note of ordered) {
        for (;;) {
            const previous = kept.at(-1);
            if (!previous || previous.offSeconds <= note.onSeconds) {
                break;
            }
            previous.offSeconds = note.onSeconds - frameSeconds;
            if (previous.offSeconds > previous.onSeconds) {
                break;
            }
            // Covered entirely by the note that follows it: there is no
            // sounding stretch left to give it.
            kept.pop();
        }
        kept.push(note);
    }
    return kept;
}

/** A key of one instrument's sounding set: one bit per channel and note. */
function soundingKey(note: ProjectedNote): string {
    return `${note.channel}:${note.note}`;
}

function groupByKey(notes: readonly ProjectedNote[]): ReadonlyMap<string, ProjectedNote[]> {
    const byKey = new Map<string, ProjectedNote[]>();
    for (const note of notes) {
        const existing = byKey.get(soundingKey(note));
        if (existing) {
            existing.push(note);
            continue;
        }
        byKey.set(soundingKey(note), [note]);
    }
    return byKey;
}

/**
 * The events one target owes for the span.
 *
 * A note is admitted by its note-on alone, and its note-off travels with it
 * however far past the span's end it lands: a release the span dropped would
 * leave the key sounding until the engine's own stop or seam released it.
 */
function eventsForSpan(notes: readonly ProjectedNote[], span: LiveMidiSpan): AudioGraphMidiNoteEvent[] {
    const events = notes
        .filter((note) => note.onSeconds >= span.startSeconds && note.onSeconds < span.endSeconds)
        .flatMap((note): AudioGraphMidiNoteEvent[] => [
            {
                time: note.onSeconds,
                note: note.note,
                velocity: clampVelocity(note.velocity),
                channel: note.channel,
                isNoteOn: true,
            },
            { time: note.offSeconds, note: note.note, velocity: 0, channel: note.channel, isNoteOn: false },
        ]);
    // `try_extend` refuses a batch that is not frame-ordered within itself, and
    // a release settles before the key sounds again at the same frame.
    return events.sort((left, right) => left.time - right.time || Number(left.isNoteOn) - Number(right.isNoteOn));
}

type ClipProjectionInput = Readonly<{
    clip: ResolvedClip;
    track: Track;
    input: LiveMidiProgrammeInput;
    projectBeatToSeconds: (beat: number) => number;
}>;

/** The notes one clip contributes, expanded over its loop iterations. */
function projectClipNotes({ clip, track, input, projectBeatToSeconds }: ClipProjectionInput): ProjectedNote[] {
    const sourceNotes = input.notesByClipId[clip.id];
    const clipVisualLength = clip.endBeat - clip.startBeat;
    if (!sourceNotes || clipVisualLength <= 0) {
        return [];
    }
    const loopEnabled = clip.loopEnabled ?? false;
    const { iterationCount, loopLengthBeats } = projectClipLoopExpansion({
        clipDurationBeats: clipVisualLength,
        configuredLoopLengthBeats: clip.loopLength,
        loopEnabled,
    });
    const sourceOccurrenceOffset = getSourceOccurrenceOffset({
        sourceStartBeat: clip.sourceStartBeat,
        segmentStartBeat: clip.startBeat,
        loopLength: loopLengthBeats,
        loopEnabled,
    });

    const projected: ProjectedNote[] = [];
    for (let iteration = 0; iteration < iterationCount; iteration++) {
        const absoluteOccurrenceIndex = sourceOccurrenceOffset + iteration;
        const admitted = sourceNotes.filter((note) =>
            input.selectProbability({
                projectProbabilitySeed: input.probabilitySeed,
                clipId: clip.id,
                eventId: note.id,
                absoluteOccurrenceIndex,
                probabilityPercent: note.probability ?? 100,
            })
        );
        const events = input.projectMidiEvents({
            events: admitted,
            clipId: clip.id,
            clipStartBeat: clip.startBeat,
            clipEndBeat: clip.endBeat,
            iterationStartBeat: clip.startBeat + iteration * loopLengthBeats,
            loopLengthBeats,
            midiOffsetBeats: clip.midiOffsetBeats ?? 0,
            loopEnabled,
            phase: 'complete',
        });
        for (const event of events) {
            projected.push({
                onSeconds: projectBeatToSeconds(event.startBeat),
                offSeconds: projectBeatToSeconds(event.startBeat + event.duration),
                note: conformPitch({
                    projectChordPitch: track.followChordTrack ? input.projectChordPitch : null,
                    pitch: event.pitch,
                    referenceBeat: clip.startBeat,
                    targetBeat: event.startBeat,
                }),
                channel: event.channel ?? 0,
                velocity: event.velocity,
            });
        }
    }
    return projected;
}

/**
 * The pitch this note sounds at, conformed to the chord track exactly as the
 * offline path conforms it: read against the clip's own start, which is the
 * reference beat a clip's harmony is stated at.
 */
function conformPitch(input: {
    projectChordPitch: OfflineChordPitchProjector | null;
    pitch: number;
    referenceBeat: number;
    targetBeat: number;
}): number {
    const { projectChordPitch, pitch, referenceBeat, targetBeat } = input;
    if (!projectChordPitch) {
        return pitch;
    }
    return projectChordPitch({ pitch, referenceBeat, targetBeat });
}

export function projectLiveMidiProgramme(input: LiveMidiProgrammeInput): LiveMidiProgramme {
    const { stripTracks, attachedInstanceIds, bakedStripIds, carriedStripIds, sampleRate, span } = input;
    const frameSeconds = 1 / sampleRate;

    function projectBeatToSeconds(beat: number): number {
        return input.projectPpqEndpoints({
            startPpq: beat,
            endPpq: beat,
            defaultTempo: input.defaultTempo,
            sampleRate,
            changes: input.changes,
        }).startSeconds;
    }

    const targets: LiveMidiProgrammeTarget[] = [];
    const exclusions: LiveMidiProgrammeExclusion[] = [];
    const nativeVoicedStripIds = new Set<string>();

    for (const track of stripTracks) {
        const sink = nativeMidiNoteSink({ track, attachedInstanceIds, bakedStripIds });
        if (sink.outcome === 'none') {
            continue;
        }
        if (sink.outcome === 'excluded') {
            exclusions.push({ stripId: track.id, reason: sink.reason });
            continue;
        }
        // A later carrier rule (`stripCarriers.ts`) can leave this strip on Web
        // Audio even though it holds a voiced sink — an uncarried second device
        // in its chain, or live input monitoring — and Web Audio already sounds
        // a built-in there, so sending it notes too would sound the same
        // generator twice. A hosted instrument on such a strip is already named
        // by `notifySilentHostedPlugins`.
        if (!carriedStripIds.has(track.id)) {
            continue;
        }
        nativeVoicedStripIds.add(track.id);

        const notes = resolveTrackClipsWithComping(track.id, track.clips)
            // Muted clips render nothing, exactly as `scheduleMidiNotes` skips
            // them on the Web Audio path.
            .filter((clip) => clip.type === 'midi' && !clip.muted)
            .flatMap((clip) => projectClipNotes({ clip, track, input, projectBeatToSeconds }));

        const sounded = [...groupByKey(notes).values()].flatMap((keyNotes) =>
            resolveSameKeyOverlaps(keyNotes, frameSeconds)
        );
        const events = eventsForSpan(sounded, span);
        if (events.length === 0) {
            continue;
        }
        targets.push({ target: { trackId: track.id, deviceId: sink.device.id }, events });
    }

    return { targets, exclusions, nativeVoicedStripIds };
}
