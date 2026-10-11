/**
 * The live automation projection, read off project truth (#3068).
 *
 * `projectLiveAutomationWrites` is pure and takes its lanes, its clock and its
 * compensation as plain values; this is the one place that binds them to the
 * stores, mirroring `readLiveGraphProgramme.ts` — the same split, for the same
 * reason: a pure producer stays testable with plain inputs, and a session
 * caller gets one place that reads the stores rather than each caller reading
 * its own subset.
 *
 * The tempo projection comes from `offlinePpqEndpointProjectorState`, the
 * projector the composition root injects — see `readLiveGraphProgramme.ts`'s
 * own note on why that is the shared clock rather than a second one AudioEngine
 * would otherwise have to derive. An unconfigured projector answers no
 * automation rather than a guessed one.
 *
 * The VCA fold is resolved here rather than passed in by the caller, the same
 * way `startNativeLiveGraphSession.ts`'s own topology reader resolves it: the
 * multiplier is a pure function of each strip's `vcaGroupId` (already on the
 * `stripTracks` the caller hands in) and the project's VCA group config, so
 * there is nothing session-shaped about deriving it here.
 *
 * ── Which devices the engine may be stamped for ─────────────────────────
 *
 * Two families, each admitted only where the session claimed the strip and the
 * engine reports the device in the chain it actually built. Either condition
 * missing means Web Audio is still driving that parameter, and admitting it
 * here would drive one body from both engines at once.
 *
 * A hosted plugin needs one thing more: the device must resolve to a plugin
 * instance, because the law it is held to is that instance's own published
 * parameter list (#3568). A built-in needs the engine to build a body for its
 * type at all — `nativeBuiltinBody`, the renderer's mirror of the engine's own
 * registry — because that is what decides whether `write-device-parameter`
 * resolves a native address for it (#3893). The built-in half of the law, and
 * the re-addressing below, are `nativeBuiltinAutomation`'s — the one copy the
 * desktop export's native render shares (#3776).
 *
 * The laws are Arrangement's own, reached through the composition-root seam
 * (`offlineDeviceParameterLawState`) for the reason that seam exists: an
 * AudioEngine → `Arrangement/useCases` import inverts the dependency and closes
 * a module cycle. The seam carries one half per family, and each half is read
 * on its own: unset means no law was injected for *that* family, not "anything
 * goes" and not a refusal of the other one, whose functions arrived
 * independently and answer a different question.
 *
 * ── Which name a stamp travels under ────────────────────────────────────
 *
 * A lane is authored in the id project truth stores, and the engine resolves a
 * built-in stamp by the name that body answers to; for a Fermenter the two are
 * spelled differently on purpose. This file re-addresses each such entry
 * (`nativeBuiltinAutomation`'s `addressNatively`), rather than the pure
 * projector doing it, because the projector is handed entries and a law and
 * never reads a type registry — binding one is exactly what this file is for.
 */

import { deriveVcaMultiplier, getVcaGroupsState, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationLaneCeiling } from '#/modules/Automation/useCases';
import { DEFAULT_TEMPO_BPM, defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';
import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import {
    REFUSE_DEVICE_AUTOMATION,
    type StripAutomationDeviceEntry,
} from '../offlineRender/projectStripAutomationWrites';

import { engineHostedStripIds } from './engineHostedStripIds';
import { isDeviceCarriedByNativeSession } from './isDeviceCarriedByNativeSession';
import { nativeBuiltinAutomation } from './nativeBuiltinAutomation';
import { nativeBuiltinBody } from './nativeBuiltinBodies';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { projectLiveAutomationWrites, type LiveAutomationWrites } from './projectLiveAutomationWrites';
import { type StripCarrier } from './stripCarriers';

/** What a session with no clock to place automation on holds. */
const NO_AUTOMATION: LiveAutomationWrites = { entries: [], exclusions: [] };

/** The instance's own published law, for the devices that have one. */
type HostedParameterHalf = Readonly<{
    accepts: (externalInstanceId: string, parameterId: string) => boolean;
    clamp: (input: { externalInstanceId: string; parameterId: string; value: number }) => number;
}>;

/** The hosted plugin instance behind each device on these strips, by device id. */
function instanceIdByDeviceId(stripTracks: readonly Track[]): ReadonlyMap<string, string> {
    const instances = new Map<string, string>();
    for (const track of stripTracks) {
        for (const device of track.devices) {
            if (device.externalInstanceId !== undefined) {
                instances.set(device.id, device.externalInstanceId);
            }
        }
    }
    return instances;
}

/**
 * The two halves of the seam, and the one law the projection is held to.
 *
 * `quantiseValue` is the declared *type* law and belongs to both halves: it is
 * asked of the device type, which every family has. Without it neither family
 * can be admitted, because the value stamped would be one nothing had held to
 * the parameter's declared grain.
 */
function liveDeviceParameterLaw(
    stripTracks: readonly Track[],
    builtin: OfflineDeviceAutomationLaw | null
): {
    law: OfflineDeviceAutomationLaw;
    hosted: HostedParameterHalf | null;
} {
    const { acceptsExternalPluginParameter, clampExternalPluginValue, quantiseValue } = offlineDeviceParameterLawState;
    const refused = { law: REFUSE_DEVICE_AUTOMATION, hosted: null };
    if (!quantiseValue) {
        return refused;
    }
    const hosted: HostedParameterHalf | null =
        acceptsExternalPluginParameter && clampExternalPluginValue
            ? { accepts: acceptsExternalPluginParameter, clamp: clampExternalPluginValue }
            : null;
    if (!hosted && !builtin) {
        return refused;
    }

    const instances = instanceIdByDeviceId(stripTracks);
    return {
        hosted,
        law: {
            // Which family answers is decided by what the device is, exactly as
            // the engine's own mapper decides it: a device that resolves to an
            // instance is the plugin's to speak for, and anything else is a
            // built-in, held to `nativeBuiltinAutomation`'s law.
            acceptsAutomation: (candidate) => {
                const externalInstanceId = instances.get(candidate.deviceId);
                if (externalInstanceId !== undefined) {
                    return hosted !== null && hosted.accepts(externalInstanceId, candidate.parameterId);
                }
                return builtin !== null && builtin.acceptsAutomation(candidate);
            },
            clampValue: (candidate) => {
                const { deviceId, paramId, value } = candidate;
                const externalInstanceId = instances.get(deviceId);
                if (externalInstanceId !== undefined) {
                    return hosted === null ? value : hosted.clamp({ externalInstanceId, parameterId: paramId, value });
                }
                return builtin === null ? value : builtin.clampValue(candidate);
            },
            // Identity for `external-plugin` today, and read from the seam rather
            // than assumed so a declared type law arriving for the family reaches
            // the stamped value the same tick it reaches the tick path's.
            quantiseValue: ({ deviceType, paramId, value }) => quantiseValue({ deviceType, paramId, value }),
        },
    };
}

/** The hosted devices the engine is sounding on one strip, in that strip's chain order. */
function carriedHostedDevices(track: Track): readonly StripAutomationDeviceEntry[] {
    return track.devices.flatMap((device) =>
        device.externalInstanceId !== undefined && isDeviceCarriedByNativeSession(track.id, device.id)
            ? [{ deviceId: device.id, deviceType: device.type, externalInstanceId: device.externalInstanceId }]
            : []
    );
}

/** The built-ins the engine is sounding on one strip, in that strip's chain order. */
function carriedBuiltinDevices(track: Track): readonly StripAutomationDeviceEntry[] {
    return track.devices.flatMap((device) =>
        nativeBuiltinBody(device.type) !== null && isDeviceCarriedByNativeSession(track.id, device.id)
            ? [{ deviceId: device.id, deviceType: device.type }]
            : []
    );
}

/**
 * The strips this write's delay must be measured against (#4153).
 *
 * The session has claimed its strips by the time a writer arms, so its carried
 * set names every track the engine sounds — but a claim is read off
 * `create-track-strip` commands and never names a bus, and the engine's own
 * compensation counts a Bacteria on a bus like any other. So the carried tracks
 * are extended with the bus strips `engineHostedStripIds` names against them,
 * which is the same law the session's programme was read under rather than a
 * second derivation of it: a write delayed against a different set than its
 * programme lands off the material it is meant to move.
 */
function engineHostedStripIdsOfCarriedSession(stripTracks: readonly Track[]): ReadonlySet<string> {
    const carried = nativeLiveGraphSession.carriedStripIds;
    const carriers = new Map<string, StripCarrier>(
        [...carried].map((stripId): [string, StripCarrier] => [stripId, { carrier: 'native' }])
    );
    return new Set([...carried, ...engineHostedStripIds(carriers, stripTracks)]);
}

export type ReadLiveAutomationWritesInput = Readonly<{
    /** The strips this session builds, in project order — tracks and buses alike. */
    stripTracks: readonly Track[];
    /** The frame grid every beat is placed on, matching the caller's own transport. */
    sampleRate: number;
    /** The absolute-time window lane B's writer is about to schedule into. */
    regionStartSeconds: number;
    regionEndSeconds: number;
}>;

export function readLiveAutomationWrites(input: ReadLiveAutomationWritesInput): LiveAutomationWrites {
    const { stripTracks, sampleRate, regionStartSeconds, regionEndSeconds } = input;
    const { project: projectPpqEndpoints } = offlinePpqEndpointProjectorState;
    if (!projectPpqEndpoints) {
        return NO_AUTOMATION;
    }

    const defaultTempo = transportStore.value?.tempo ?? DEFAULT_TEMPO_BPM;
    const changes = tempoMapStore.value?.changes ?? [];

    const projectBeatToSeconds = (beat: number): number =>
        projectPpqEndpoints({ startPpq: beat, endPpq: beat, defaultTempo, sampleRate, changes }).startSeconds;

    const vcaGroups = getVcaGroupsState();
    const vcaMultiplierByTrackId = new Map(
        stripTracks.map((track): [string, number] => [
            track.id,
            deriveVcaMultiplier({ vcaGroupId: track.vcaGroupId, groups: vcaGroups }),
        ])
    );

    const builtinAutomation = nativeBuiltinAutomation({ source: offlineDeviceParameterLawState, stripTracks });
    const builtin = builtinAutomation.law;
    const { law, hosted } = liveDeviceParameterLaw(stripTracks, builtin);
    const trackById = new Map(stripTracks.map((track): [string, Track] => [track.id, track]));
    const hostedStripIds = engineHostedStripIdsOfCarriedSession(stripTracks);

    const projected = projectLiveAutomationWrites({
        stripTracks,
        lanes: automationStore.value?.lanes ?? [],
        regionStartSeconds,
        regionEndSeconds,
        defaultTempo,
        changes,
        projectBeatToSeconds,
        sampleRate,
        compensationDelaySeconds: (stripId) => getCompensationDelay(stripId, undefined, hostedStripIds),
        vcaMultiplierByTrackId,
        slewTickSeconds: automationSlewTickSecondsForGrain(
            transportStore.value?.scheduleGrainMs ?? defaultTransportState.scheduleGrainMs
        ),
        resolveLaneCeiling: getAutomationLaneCeiling,
        carriedDeviceEntries: (stripId) => {
            const track = trackById.get(stripId);
            if (!track) {
                return [];
            }
            return [...(hosted ? carriedHostedDevices(track) : []), ...(builtin ? carriedBuiltinDevices(track) : [])];
        },
        deviceParameterLaw: law,
    });

    return { ...projected, entries: projected.entries.map(builtinAutomation.addressNatively) };
}
