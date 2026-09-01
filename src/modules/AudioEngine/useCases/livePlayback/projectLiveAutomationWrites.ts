/**
 * The live session's automation, in absolute engine-clock seconds (#3068).
 *
 * `projectStripAutomationWrites` is the export's own per-strip projection —
 * the recording-and-converting run of `scheduleTrackAutomation` that carries
 * every lane law (link resolution, the decibel fader law, the VCA fold, the
 * send clamp, clip windows, tempo projection, latency compensation). This
 * producer shares it rather than mirrors it, for the same reason
 * `projectLiveGraphProgramme` shares `projectOfflineAudioClipPlaybacks`: a
 * second copy of those laws is one that agrees today and drifts tomorrow.
 *
 * ── Region and absolute time ────────────────────────────────────────────
 *
 * The extraction's own writes are relative to `regionStartSeconds` — the
 * origin `compileAutomationEvents` emits against, which is exactly what an
 * *export* wants, because the region it is handed is the file being bounced.
 * A live session is not a file: lane B's windowed writer stamps every write
 * onto the engine's own absolute clock, so this producer adds
 * `regionStartSeconds` back onto every write the extraction hands it before
 * returning it (see {@link offsetWrite}).
 *
 * `durationSeconds` handed to the extraction is `regionEndSeconds -
 * regionStartSeconds`. That is the window lane B is about to schedule into,
 * and it is also exactly the bound `compileAutomationEvents` clips a
 * segment to: a segment crossing it is emitted with a re-interpolated value
 * at the boundary, at the segment's own slope, rather than emitted whole or
 * dropped — so nothing here re-derives that clip a second time.
 *
 * ── Admission and exclusions ────────────────────────────────────────────
 *
 * A strip's sends are admitted through {@link admittedSendBusIds}, the exact
 * predicate `projectLiveGraphTopology` applies to the batch's `add-send`
 * commands: a send the topology dropped gets no target here either, or the
 * automation would name a path the graph never built.
 *
 * A device-parameter lane (#3124) is detected here, not by the extraction:
 * `projectStripAutomationWrites` resolves it against an empty device chain
 * and silently drops it, matching what main did for an orphan lane left
 * behind by `prepareRemoveDevice.ts` (which deletes the device, never its
 * lanes). Live has an exclusion channel the export does not, so this producer
 * names each such lane on its own — one exclusion per lane, keyed to that
 * lane — while still emitting the strip's converted fader/pan/send entries:
 * one lane the writer cannot carry must not silence the rest of the strip.
 *
 * A strip the extraction declines outright — today, only a malformed
 * recorded event stream — is excluded whole, keyed to the strip itself: the
 * same law `projectLiveGraphProgramme` applies to a clip it cannot carry. One
 * strip's automation failing to compile must not silence a session that
 * could otherwise play.
 */

import { type Track } from '#/modules/Arrangement/stores';
import { resolveLinkedLane } from '#/utils/automationLaneLink';

import { type AudioGraphParameterWrite, type AudioGraphStripParameterTarget } from '../../models/AudioGraphBackend';
import { type AutomationLane } from '../../models/AutomationViewTypes';
import {
    projectStripAutomationWrites,
    type StripAutomationWritesInput,
} from '../offlineRender/projectStripAutomationWrites';

import { admittedSendBusIds } from './admittedSendBusIds';

export type LiveAutomationWritesExclusion = Readonly<{
    stripId: string;
    /** The lane the writer cannot carry, or the strip when its whole automation stream was declined. */
    subjectId: string;
    reason: string;
}>;

export type LiveAutomationWritesEntry = Readonly<{
    target: AudioGraphStripParameterTarget;
    writes: readonly AudioGraphParameterWrite[];
}>;

export type LiveAutomationWrites = Readonly<{
    entries: readonly LiveAutomationWritesEntry[];
    exclusions: readonly LiveAutomationWritesExclusion[];
}>;

export type LiveAutomationWritesInput = Readonly<{
    /** Every strip this session builds, in project order — tracks and buses alike, matching the mixer state `projectLiveGraphTopology` gives both. */
    stripTracks: readonly Track[];
    lanes: readonly AutomationLane[];
    /** The absolute-time window lane B's writer is about to schedule into. */
    regionStartSeconds: number;
    regionEndSeconds: number;
    defaultTempo: number;
    changes: readonly { beat: number; tempo: number }[];
    projectBeatToSeconds: (beat: number) => number;
    sampleRate: number;
    /** The strip's latency compensation, in seconds. */
    compensationDelaySeconds: (stripId: string) => number;
    vcaMultiplierByTrackId: ReadonlyMap<string, number>;
    slewTickSeconds: number;
    resolveLaneCeiling: StripAutomationWritesInput['resolveLaneCeiling'];
}>;

const KNOWN_STRIP_PARAMETER_IDS = new Set(['gain', 'pan']);
const SEND_PARAMETER_PREFIX = 'send:';
const DEVICE_AUTOMATION_EXCLUSION_REASON = 'device parameter automation has no native body yet (#3124)';

/**
 * Enabled lanes on this strip that name neither the fader, the pan, nor a
 * send — the device-parameter family `projectStripAutomationWrites` silently
 * drops today, matching main. This producer names each one as its own
 * exclusion rather than let it vanish with no signal (#3068).
 *
 * Mirrors `scheduleTrackAutomation`'s own drop conditions
 * (`repositories/offlineScheduler/automationScheduling.ts`) so this never
 * excludes a lane the scheduler would never have carried anyway: a clip-scoped
 * lane whose clip is not in `clipBoundsById` (the clip was removed or never
 * built), and a lane that resolves — after following its link chain — to no
 * points at all.
 */
function deviceParameterLanes(
    lanes: readonly AutomationLane[],
    laneById: ReadonlyMap<string, AutomationLane>,
    trackId: string,
    clipBoundsById: ReadonlyMap<string, { startBeat: number; endBeat: number }>
): readonly AutomationLane[] {
    return lanes.filter((lane) => {
        if (lane.trackId !== trackId || lane.enabled === false) {
            return false;
        }
        if (KNOWN_STRIP_PARAMETER_IDS.has(lane.parameterId) || lane.parameterId.startsWith(SEND_PARAMETER_PREFIX)) {
            return false;
        }
        if (lane.clipId && !clipBoundsById.has(lane.clipId)) {
            return false;
        }
        const resolved = resolveLinkedLane(lane.id, (id) => laneById.get(id));
        if (!resolved) {
            return false;
        }
        const sourceLane = laneById.get(resolved.sourceLaneId);
        return sourceLane !== undefined && sourceLane.points.length > 0;
    });
}

function assertNever(value: never): never {
    throw new Error(`Unknown automation write shape: ${JSON.stringify(value)}`);
}

/** Shifts a region-relative write onto the absolute engine clock (see the header). */
function offsetWrite(write: AudioGraphParameterWrite, offsetSeconds: number): AudioGraphParameterWrite {
    switch (write.shape) {
        case 'ramp-to':
            return { ...write, startTime: write.startTime + offsetSeconds, landTime: write.landTime + offsetSeconds };
        case 'step':
        case 'smoothed':
        case 'hold':
            return { ...write, time: write.time + offsetSeconds };
        default:
            return assertNever(write);
    }
}

export function projectLiveAutomationWrites(input: LiveAutomationWritesInput): LiveAutomationWrites {
    const {
        stripTracks,
        lanes,
        regionStartSeconds,
        regionEndSeconds,
        defaultTempo,
        changes,
        projectBeatToSeconds,
        sampleRate,
        compensationDelaySeconds,
        vcaMultiplierByTrackId,
        slewTickSeconds,
        resolveLaneCeiling,
    } = input;

    const busStripIds = new Set(stripTracks.filter((track) => track.kind === 'bus').map((track) => track.id));
    const durationSeconds = Math.max(0, regionEndSeconds - regionStartSeconds);
    const laneById = new Map<string, AutomationLane>();
    for (const lane of lanes) {
        laneById.set(lane.id, lane);
    }

    const entries: LiveAutomationWritesEntry[] = [];
    const exclusions: LiveAutomationWritesExclusion[] = [];

    for (const track of stripTracks) {
        const clipBoundsById = new Map<string, { startBeat: number; endBeat: number }>();
        for (const clip of track.clips) {
            clipBoundsById.set(clip.id, { startBeat: clip.startBeat, endBeat: clip.endBeat });
        }

        // `automationMode: 'off'` produces no writes at all — enforced inside
        // `projectStripAutomationWrites` itself, and it reads no lane at all,
        // the orphan device lane included. So a strip with automation turned
        // off never earns an exclusion for a lane it was never going to read.
        if (track.automationMode !== 'off') {
            for (const lane of deviceParameterLanes(lanes, laneById, track.id, clipBoundsById)) {
                exclusions.push({ stripId: track.id, subjectId: lane.id, reason: DEVICE_AUTOMATION_EXCLUSION_REASON });
            }
        }

        const projected = projectStripAutomationWrites({
            track,
            admittedSendBusIds: admittedSendBusIds({ track, busStripIds }),
            lanes,
            regionStartSeconds,
            durationSeconds,
            defaultTempo,
            changes,
            projectBeatToSeconds,
            sampleRate,
            compensationDelaySec: compensationDelaySeconds(track.id),
            vcaMultiplier: vcaMultiplierByTrackId.get(track.id) ?? 1,
            slewTickSeconds,
            resolveLaneCeiling,
        });

        if (projected.outcome === 'declined') {
            exclusions.push({ stripId: track.id, subjectId: track.id, reason: projected.reason });
            continue;
        }
        for (const entry of projected.entries) {
            entries.push({
                target: entry.target,
                writes: entry.writes.map((write) => offsetWrite(write, regionStartSeconds)),
            });
        }
    }

    return { entries, exclusions };
}
