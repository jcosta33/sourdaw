/**
 * The live session's programme: which material each strip plays, and when
 * (#3068, D3.c.4b).
 *
 * `projectLiveGraphTopology` says what the graph *is*; this says what it
 * *plays*. The two are separate producers because they fail differently — a
 * missing strip is a graph that is not the project, while a missing playback
 * is a strip that is silent — and because only this half needs a clock.
 *
 * ── One arithmetic, shared with the export ────────────────────────────────
 *
 * Every number here comes from `projectOfflineAudioClipPlaybacks`, the same
 * projector `renderOfflineWithNativeEngine` schedules the bounce from, over
 * the same comped clip set (`resolveTrackClipsWithComping`) and the same
 * latency compensation (`getCompensationDelay`). That is not tidiness: the
 * live engine and the bounce are meant to be the same render, and a second
 * copy of loop expansion, trim, fade and source-offset arithmetic is exactly
 * how they stop being one. `projectLiveGraphProgrammeParity.spec.ts` renders
 * both projections through the one offline renderer and requires them
 * bit-identical.
 *
 * ── A frozen track plays its bake, and nothing else ───────────────────────
 *
 * `scheduleTrackClips` is the law: a frozen track's clips are not scheduled at
 * all, its baked buffer is, and that buffer is connected *past* the device
 * chain — the processing is already inside it, so running the chain again
 * would print it twice. The native strip has no per-source chain bypass, so
 * the same law is expressed by building the strip with no chain at all
 * ({@link frozenBake}, and the device drop in `projectLiveGraphTopology`).
 *
 * The bake is anchored the way `scheduleFrozenTrack` renders it: from the
 * track's earliest clip start, not from timeline zero. A live session has no
 * region, so there is nothing to trim against — the bake starts where the
 * track's content starts and runs for as long as it was baked.
 *
 * ── Per-clip exclusions, all visible ──────────────────────────────────────
 *
 * Every exclusion below shares one law: the cost of what this producer cannot
 * carry is *that clip*, never the session. A `schedule-clip` the engine refuses
 * takes the whole batch down with it, so a batch that would be refused is a
 * play button that starts no engine at all — and one pathological clip must not
 * be able to do that to a project.
 *
 * A stretched clip is refused by the engine, not by taste:
 * `schedule-clip` answers `stretched-clip-unsupported` for any non-unity
 * `playbackRate` (`crates/sourdaw-native/src/commands/graph.rs`). Lifting the
 * exclusion is engine work (the `TimelineClip` has nowhere to carry a rate),
 * never a producer emitting a command the engine refuses.
 *
 * A clip whose material is not in the buffer cache is dropped for the
 * narrower reason that there is nothing to register into the native sample
 * pool, and a `schedule-clip` naming a sample the pool does not hold is
 * refused by name.
 *
 * A clip whose loop expansion does not fit its track's remaining native clip
 * capacity is dropped whole ({@link MAX_NATIVE_TRACK_CLIPS}), and so is one
 * whose expansion exceeds the allocation budget
 * ({@link MAX_NATIVE_CLIP_ITERATIONS}). Both are counted before any of the
 * clip's iterations are admitted, because a clip half-scheduled is a clip that
 * stops sounding part-way through with nothing saying why.
 *
 * MIDI is out of this slice (#3122): an instrument renders on the Web Audio
 * path, so a MIDI clip is skipped here rather than turned into a rest.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphClipPlayback } from '../../models/AudioGraphBackend';
import {
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { MICRO_FADE_SECONDS } from '../offlineRender/constants';
import { projectNativeClipFade } from '../offlineRender/projectNativeClipFade';
import { projectOfflineAudioClipPlaybacks } from '../offlineRender/projectOfflineAudioClipPlaybacks';
import { resolveTrackClipsWithComping } from '../offlineRender/resolveTrackClipsWithComping';

/**
 * A live session plays the arrangement from its head, so every time in this
 * producer is an absolute timeline second. The export's region offset is the
 * only reason `projectOfflineAudioClipPlaybacks` takes a region at all, and a
 * live session has none.
 */
const LIVE_REGION_START_BEAT = 0;

/**
 * How many clips one native track strip holds — `MAX_TRACK_CLIPS` in
 * `crates/daw-engine/src/timeline.rs`, mirrored because the producer's job is
 * to emit a batch the engine takes.
 *
 * The engine's own answer to the 1025th is to refuse the command, and a refusal
 * is whole-batch. One clip's loop expansion can reach four thousand iterations
 * on its own (`projectClipLoopExpansion`'s ceiling), so this is not a
 * theoretical bound: a single over-long loop would otherwise cost the session
 * every strip it has.
 */
const MAX_NATIVE_TRACK_CLIPS = 1024;

/**
 * How many iterations one clip's loop expansion may allocate for.
 *
 * Every `schedule-clip` copies the sample's *whole* PCM into the engine — the
 * mapper hands `TimelineClip::new` a `sample.left.clone()`
 * (`crates/sourdaw-native/src/commands/graph.rs`), and `TimelineClip` owns
 * `Vec<f32>` rather than sharing the pool's — so a loop's expansion multiplies
 * its material instead of referencing it. Referencing it is the engine-side
 * fix and it is filed as #3134; until that lands, the producer is the only
 * thing standing between one looped clip and an unbounded native allocation.
 *
 * Sixty-four is where ordinary material stops and pathology starts. A one-bar
 * loop at 120 BPM is two seconds — around 750 KiB of stereo 48 kHz float — so
 * this budget admits a loop dragged across sixteen bars of arrangement at
 * roughly 50 MiB, which is the most one clip may cost. The loop projector's own
 * ceiling is 4096 iterations, three orders of magnitude past that, and the
 * engine would try to hold every one.
 *
 * It bounds one clip, not a project: a session with many looped clips still
 * allocates the sum of them. That is deliberate — a project-wide ceiling would
 * make which clips play depend on the order they are walked in, and the real
 * ceiling belongs to the engine.
 */
const MAX_NATIVE_CLIP_ITERATIONS = 64;

export type LiveGraphProgrammeExclusion = Readonly<{
    stripId: string;
    /** The clip that was dropped, or the track id for a frozen bake. */
    subjectId: string;
    reason: string;
}>;

export type LiveGraphProgrammeInput = Readonly<{
    /** Every track and bus the session builds a strip for, in project order. */
    stripTracks: readonly Track[];
    sampleRate: number;
    defaultTempo: number;
    changes: Parameters<OfflinePpqEndpointProjector>[0]['changes'];
    projectPpqEndpoints: OfflinePpqEndpointProjector;
    resolveTempoAtBeat: OfflineTempoAtBeatResolver;
    /** Decoded material by id — `audioBufferCache.get` in production. */
    readBuffer: (bufferId: string) => AudioBuffer | undefined;
    /** The strip's latency compensation, in seconds. */
    compensationDelaySeconds: (stripId: string) => number;
}>;

export type LiveGraphProgramme = Readonly<{
    /** What each strip plays. A strip with nothing to play is absent. */
    playbacksByStripId: ReadonlyMap<string, readonly AudioGraphClipPlayback[]>;
    /** Strips whose device chain the programme replaces — the frozen ones. */
    bakedStripIds: ReadonlySet<string>;
    /** Everything this projection could not carry, and why. */
    exclusions: readonly LiveGraphProgrammeExclusion[];
}>;

/**
 * How far the programme reaches, in seconds.
 *
 * The bound `projectOfflineAudioClipPlaybacks` takes is a render's own length;
 * a live session has no length, so the horizon is the project's content end —
 * past which there is nothing left to schedule anyway. Stated as the content
 * end rather than as `Infinity` because the projector compares against it, and
 * a non-finite bound would put `NaN` into the loop expansion's arithmetic.
 */
function programmeHorizonSeconds(input: {
    stripTracks: readonly Track[];
    projectBeatToSeconds: (beat: number) => number;
    readBuffer: (bufferId: string) => AudioBuffer | undefined;
}): number {
    const { stripTracks, projectBeatToSeconds, readBuffer } = input;
    let horizon = 0;
    for (const track of stripTracks) {
        for (const clip of track.clips) {
            horizon = Math.max(horizon, projectBeatToSeconds(clip.endBeat));
        }
        const bake = frozenBake({ track, readBuffer });
        if (bake) {
            horizon = Math.max(horizon, projectBeatToSeconds(bake.startBeat) + bake.buffer.duration);
        }
    }
    return horizon;
}

/** The baked buffer a frozen track plays instead of its clips, if it has one. */
function frozenBake(input: {
    track: Track;
    readBuffer: (bufferId: string) => AudioBuffer | undefined;
}): Readonly<{ bufferId: string; buffer: AudioBuffer; startBeat: number }> | null {
    const { track, readBuffer } = input;
    const { freezeState } = track;
    if (freezeState.status !== 'frozen' || !freezeState.frozenBufferId) {
        return null;
    }
    const buffer = readBuffer(freezeState.frozenBufferId);
    if (!buffer) {
        return null;
    }
    return {
        bufferId: freezeState.frozenBufferId,
        buffer,
        // `scheduleFrozenTrack` bakes from the track's earliest clip start, so
        // that is where the bake is anchored on replay. A track with no clips
        // has nothing earlier than the timeline head.
        startBeat: track.clips.length > 0 ? Math.min(...track.clips.map((clip) => clip.startBeat)) : 0,
    };
}

export function projectLiveGraphProgramme(input: LiveGraphProgrammeInput): LiveGraphProgramme {
    const {
        stripTracks,
        sampleRate,
        defaultTempo,
        changes,
        projectPpqEndpoints,
        resolveTempoAtBeat,
        readBuffer,
        compensationDelaySeconds,
    } = input;

    function projectBeatToSeconds(beat: number): number {
        return projectPpqEndpoints({ startPpq: beat, endPpq: beat, defaultTempo, sampleRate, changes }).startSeconds;
    }
    // The flat rate at a beat, not the integrated map — a clip's source-content
    // offset answers to the tempo its material was recorded at.
    function resolveClipTempo(beat: number): number {
        return resolveTempoAtBeat({ changes, beat, defaultTempo });
    }

    const regionStartSec = projectBeatToSeconds(LIVE_REGION_START_BEAT);
    const durationSeconds = programmeHorizonSeconds({ stripTracks, projectBeatToSeconds, readBuffer });

    const playbacksByStripId = new Map<string, AudioGraphClipPlayback[]>();
    const bakedStripIds = new Set<string>();
    const exclusions: LiveGraphProgrammeExclusion[] = [];

    function admit(stripId: string, playback: AudioGraphClipPlayback): void {
        const existing = playbacksByStripId.get(stripId);
        if (existing) {
            existing.push(playback);
            return;
        }
        playbacksByStripId.set(stripId, [playback]);
    }

    for (const track of stripTracks) {
        // A bus sums; only a track plays clips, and the engine refuses a
        // `schedule-clip` addressed at a bus strip by name.
        if (track.kind === 'bus') {
            continue;
        }

        const compensationDelay = compensationDelaySeconds(track.id);
        const bake = frozenBake({ track, readBuffer });
        if (bake) {
            bakedStripIds.add(track.id);
            admit(track.id, {
                trackId: track.id,
                source: { sourceId: bake.bufferId, buffer: bake.buffer },
                startTime: Math.max(0, projectBeatToSeconds(bake.startBeat) + compensationDelay - regionStartSec),
                sourceOffsetSeconds: 0,
                durationSeconds: bake.buffer.duration,
                playbackRate: 1,
                // The bake carries the track's clip gains already; its own
                // level is unity, and only the strip's fader shapes it.
                gain: 1,
                // A bake is one continuous take, so it carries no user fade —
                // but its edges get the same anti-click floor every other
                // source gets, which is what an empty fade on each side asks
                // for (`AudioGraphClipFade`).
                fade: { fadeIn: {}, fadeOut: {}, microFadeSeconds: MICRO_FADE_SECONDS },
            });
            continue;
        }
        if (track.freezeState.status === 'frozen' && track.freezeState.frozenBufferId) {
            exclusions.push({
                stripId: track.id,
                subjectId: track.freezeState.frozenBufferId,
                reason: `track "${track.name}" is frozen but its baked buffer is not loaded`,
            });
            continue;
        }

        // What the native strip has left to hold. Counted down across the
        // track's clips, because the engine's ceiling is the strip's and one
        // clip's expansion is what spends it.
        let remainingClipSlots = MAX_NATIVE_TRACK_CLIPS;

        for (const clip of resolveTrackClipsWithComping(track.id, track.clips)) {
            if (clip.muted || clip.endBeat <= LIVE_REGION_START_BEAT || clip.endBeat - clip.startBeat <= 0) {
                continue;
            }
            if (clip.type !== 'audio') {
                // Instrument programme stays on the Web Audio path (#3122).
                continue;
            }
            const bufferId = clip.audioBufferId;
            if (!bufferId) {
                continue;
            }
            const clipLabel = clip.name || clip.id;
            const excludeClip = (reason: string): void => {
                exclusions.push({ stripId: track.id, subjectId: clip.id, reason });
            };

            const buffer = readBuffer(bufferId);
            if (!buffer) {
                excludeClip(`clip "${clipLabel}" has no decoded material to register`);
                continue;
            }

            const projected = projectOfflineAudioClipPlaybacks({
                clip,
                bufferDurationSeconds: buffer.duration,
                regionStartBeat: LIVE_REGION_START_BEAT,
                regionStartSec,
                durationSeconds,
                compensationDelay,
                projectBeatToSeconds,
                resolveTempoAtBeat: resolveClipTempo,
            });

            // Every gate below is decided over the clip's whole expansion and
            // costs the whole clip, never the batch and never half a clip. The
            // rate is one number per clip, so one iteration answering for it
            // answers for all of them.
            const stretchedRate = projected.find((playback) => playback.playbackRate !== 1)?.playbackRate;
            if (stretchedRate !== undefined) {
                excludeClip(
                    `clip "${clipLabel}" plays at rate ${String(stretchedRate)}, ` +
                        `which the native timeline cannot stretch`
                );
                continue;
            }
            if (projected.length > MAX_NATIVE_CLIP_ITERATIONS) {
                excludeClip(
                    `clip "${clipLabel}" loops ${String(projected.length)} times, past the ` +
                        `${String(MAX_NATIVE_CLIP_ITERATIONS)} the native timeline will allocate material for`
                );
                continue;
            }
            if (projected.length > remainingClipSlots) {
                excludeClip(
                    `clip "${clipLabel}" needs ${String(projected.length)} of track ` +
                        `"${track.name}"'s ${String(remainingClipSlots)} remaining native clip slots`
                );
                continue;
            }
            remainingClipSlots -= projected.length;

            for (const playback of projected) {
                admit(track.id, {
                    trackId: track.id,
                    source: { sourceId: bufferId, buffer },
                    startTime: playback.startSec,
                    sourceOffsetSeconds: playback.bufferOffsetSec,
                    durationSeconds: playback.playDuration,
                    playbackRate: playback.playbackRate,
                    gain: playback.clipGainValue,
                    fade: projectNativeClipFade(playback),
                });
            }
        }
    }

    return { playbacksByStripId, bakedStripIds, exclusions };
}
