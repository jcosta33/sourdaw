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
 * A clip whose material is not in the buffer cache is dropped for the
 * narrower reason that there is nothing to register into the native sample
 * pool, and a `schedule-clip` naming a sample the pool does not hold is
 * refused by name.
 *
 * A clip whose loop expansion does not fit its strip's remaining native clip
 * capacity is dropped whole. The verdict comes from
 * `admitNativeClipExpansion`, which the export leg asks the same question of: a
 * ceiling applied on one side only is a clip that plays in the bounce and is
 * silent here.
 *
 * MIDI is out of this slice (#3122): an instrument renders on the Web Audio
 * path, so a MIDI clip is skipped here rather than turned into a rest. Skipped
 * is not silent, though, and the producer names every strip it left that way in
 * `webVoicedStripIds`: an empty native entry means "nothing native to play"
 * rather than "nothing to play", and a reader that cannot tell the two apart
 * gates the Web Audio strip that was voicing the material out of the mix.
 */

import { type Track } from '#/modules/Arrangement/stores';
import { MICRO_FADE_SECONDS } from '#/utils/clipFadeScheduleClamp';

import { type AudioGraphClipPlayback } from '../../models/AudioGraphBackend';
import {
    type OfflinePpqEndpointProjector,
    type OfflineTempoAtBeatResolver,
} from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { admitNativeClipExpansion, MAX_NATIVE_TRACK_CLIPS } from '../offlineRender/admitNativeClipExpansion';
import { projectNativeClipFade } from '../offlineRender/projectNativeClipFade';
import { projectOfflineAudioClipPlaybacks } from '../offlineRender/projectOfflineAudioClipPlaybacks';
import { resolveTrackClipsWithComping } from '../offlineRender/resolveTrackClipsWithComping';

import { isLiveClip, LIVE_REGION_START_BEAT } from './isLiveClip';

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
    /**
     * Strips holding at least one live clip this producer did not admit as a
     * native playback: a MIDI clip, which is voiced on the Web Audio path
     * (#3122); an audio clip with no decoded material or no buffer id; a clip
     * refused by the expansion ceiling; or a frozen track whose bake is not
     * loaded. Such a strip has material only Web Audio voices, so the carrier
     * law must not read its empty native entry as nothing to sound.
     */
    webVoicedStripIds: ReadonlySet<string>;
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
    const webVoicedStripIds = new Set<string>();
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
            webVoicedStripIds.add(track.id);
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
            if (!isLiveClip(clip)) {
                continue;
            }
            if (clip.type !== 'audio') {
                // Instrument programme stays on the Web Audio path (#3122).
                webVoicedStripIds.add(track.id);
                continue;
            }
            const bufferId = clip.audioBufferId;
            if (!bufferId) {
                webVoicedStripIds.add(track.id);
                continue;
            }
            const clipLabel = clip.name || clip.id;
            // Dropping a clip names its strip web-voiced as well as naming the
            // clip: the material is still in the project, and Web Audio is the
            // only carrier left that plays it.
            const excludeClip = (reason: string): void => {
                webVoicedStripIds.add(track.id);
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
            // costs the whole clip, never the batch and never half a clip.
            const expansion = admitNativeClipExpansion({ iterations: projected.length, remainingClipSlots });
            if (!expansion.admitted) {
                excludeClip(`clip "${clipLabel}" on track "${track.name}": ${expansion.reason}`);
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

    return { playbacksByStripId, bakedStripIds, webVoicedStripIds, exclusions };
}
