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
 * A device-parameter lane is decided here, not by the extraction, because only
 * this producer knows which devices the native session is actually sounding.
 * Three outcomes, and the difference between the last two is the whole point:
 *
 *   - The lane resolves to a device this session carries, under the same
 *     `resolveDeviceAutomationTargetIndex` + law the tick path resolves on.
 *     It is handed to the extraction and comes back as a `device-parameter`
 *     entry the engine stamps (#3568).
 *   - The lane names a device with a native body this session does *not* carry
 *     — a web-carried strip, or a device no splice has placed in the native
 *     chain yet. Omitted with no exclusion: Web Audio is still driving it, so
 *     it is carried elsewhere rather than dropped, and saying otherwise would
 *     report a fault that does not exist.
 *   - Anything else — a lane on a device the engine builds no body for, or an
 *     orphan lane left behind by `prepareRemoveDevice.ts`, which deletes the
 *     device and never its lanes.
 *     `projectStripAutomationWrites` silently drops it, so this producer
 *     names each one on its exclusion channel (#3124) — where the native
 *     export, which has none, declines instead (`nativeRefusedDeviceLane.ts`)
 *     — while still emitting the strip's converted fader/pan/send entries:
 *     one lane the writer cannot carry must not silence the rest of the strip.
 *
 * A strip the extraction declines outright — today, only a malformed
 * recorded event stream — is excluded whole, keyed to the strip itself: the
 * same law `projectLiveGraphProgramme` applies to a clip it cannot carry. One
 * strip's automation failing to compile must not silence a session that
 * could otherwise play.
 *
 * Two or more lanes on one device parameter that genuinely overlap cannot all
 * fit the one schedule the extraction's recorder holds
 * (`projectStripAutomationWrites`), so `mergeAutomationSegmentStreams` keeps
 * only the lane latest in lane-array order and reports the rest on the
 * result's `overlaps` field, each overlap naming its withheld lane ids
 * directly — the parameter's entry itself still stands in `entries`, carrying
 * the kept lane's writes. Unlike the malformed-stream case above, an overlap
 * must not silence the rest of the strip either — the fader, pan and every
 * other device parameter still converted. This producer names each withheld
 * lane on its exclusion channel instead, so the exclusion points at the lane
 * a musician would need to fix rather than the strip.
 */

import { type Track } from '#/modules/Arrangement/stores';

import { type AudioGraphParameterTarget, type AudioGraphParameterWrite } from '../../models/AudioGraphBackend';
import { type AutomationLane } from '../../models/AutomationViewTypes';
import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';
import { clipBoundsById } from '../offlineRender/clipBoundsById';
import { deviceParameterLanes } from '../offlineRender/deviceParameterLanes';
import { deviceParameterOverlapReason } from '../offlineRender/deviceParameterOverlapReason';
import { laneAddressesDevice } from '../offlineRender/laneAddressesDevice';
import {
    projectStripAutomationWrites,
    type StripAutomationDeviceEntry,
    type StripAutomationWritesInput,
} from '../offlineRender/projectStripAutomationWrites';

import { admittedSendBusIds } from './admittedSendBusIds';
import { nativeBuiltinBody } from './nativeBuiltinBodies';

export type LiveAutomationWritesExclusion = Readonly<{
    stripId: string;
    /** The lane the writer cannot carry, or the strip when its whole automation stream was declined. */
    subjectId: string;
    reason: string;
}>;

export type LiveAutomationWritesEntry = Readonly<{
    target: AudioGraphParameterTarget;
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
    /**
     * The devices with a native body the session is sounding on this strip, in
     * the strip's own chain order. Everything else on the strip is either still
     * Web Audio's or has no native automation body.
     */
    carriedDeviceEntries: (stripId: string) => readonly StripAutomationDeviceEntry[];
    /** The device-parameter law both the admission and the extraction are held to. */
    deviceParameterLaw: OfflineDeviceAutomationLaw;
}>;

const DEVICE_AUTOMATION_EXCLUSION_REASON = 'device parameter automation has no native body yet (#3124)';

/**
 * Every device on this strip the engine has a body for, in chain order, as the
 * entry shape both readers take — a hosted plugin under its instance id, and a
 * built-in the engine builds under no id at all, because the engine addresses
 * it by its own vocabulary rather than through an instance.
 */
function nativeBodyDeviceEntries(track: Track): readonly StripAutomationDeviceEntry[] {
    return track.devices.flatMap((device) => {
        if (device.externalInstanceId !== undefined) {
            return [{ deviceId: device.id, deviceType: device.type, externalInstanceId: device.externalInstanceId }];
        }
        return nativeBuiltinBody(device.type) ? [{ deviceId: device.id, deviceType: device.type }] : [];
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
        carriedDeviceEntries,
        deviceParameterLaw,
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
        const carried = carriedDeviceEntries(track.id);
        // `automationMode: 'off'` produces no writes at all — enforced inside
        // `projectStripAutomationWrites` itself, and it reads no lane at all,
        // the orphan device lane included. So a strip with automation turned
        // off never earns an exclusion for a lane it was never going to read,
        // and has no consumer for the clip-bounds map either.
        if (track.automationMode !== 'off') {
            const withNativeBody = nativeBodyDeviceEntries(track);
            const candidateLanes = deviceParameterLanes({
                lanes,
                laneById,
                trackId: track.id,
                clipBounds: clipBoundsById(track),
            });
            for (const lane of candidateLanes) {
                // `carried` is a subset of `withNativeBody`, and testing it
                // separately is still not redundant: a legacy lane naming no
                // device id resolves against a single accepting candidate and
                // reports ambiguous against two
                // (`resolveDeviceAutomationTargetIndex`), so a lane that
                // resolves inside the carried subset can go unresolved across
                // the whole chain. Excluding it then would report a fault in a
                // lane the engine is stamping.
                if (
                    laneAddressesDevice(lane, carried, deviceParameterLaw) ||
                    laneAddressesDevice(lane, withNativeBody, deviceParameterLaw)
                ) {
                    continue;
                }
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
            deviceEntries: carried,
            deviceParameterLaw,
        });

        if (projected.outcome === 'declined') {
            exclusions.push({ stripId: track.id, subjectId: track.id, reason: projected.reason });
            continue;
        }
        for (const overlap of projected.overlaps) {
            const reason = deviceParameterOverlapReason(track.name, overlap);
            for (const laneId of overlap.laneIds) {
                exclusions.push({ stripId: track.id, subjectId: laneId, reason });
            }
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
