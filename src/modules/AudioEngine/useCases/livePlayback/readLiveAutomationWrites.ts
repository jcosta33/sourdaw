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
 * resolves a native address for it (#3893).
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
 * through `nativeBuiltinBody`, rather than the pure projector doing it, because
 * the projector is handed entries and a law and never reads a type registry —
 * binding one is exactly what this file is for.
 */

import { deriveVcaMultiplier, getVcaGroupsState, type Device, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationLaneCeiling } from '#/modules/Automation/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { type OfflineDeviceAutomationLaw } from '../../repositories/offlineScheduler/automationScheduling';
import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import {
    REFUSE_DEVICE_AUTOMATION,
    type StripAutomationDeviceEntry,
} from '../offlineRender/projectStripAutomationWrites';

import { isDeviceCarriedByNativeSession } from './isDeviceCarriedByNativeSession';
import { nativeBuiltinBody } from './nativeBuiltinBodies';
import {
    projectLiveAutomationWrites,
    type LiveAutomationWrites,
    type LiveAutomationWritesEntry,
} from './projectLiveAutomationWrites';

/** What a session with no clock to place automation on holds. */
const NO_AUTOMATION: LiveAutomationWrites = { entries: [], exclusions: [] };

/** The instance's own published law, for the devices that have one. */
type HostedParameterHalf = Readonly<{
    accepts: (externalInstanceId: string, parameterId: string) => boolean;
    clamp: (input: { externalInstanceId: string; parameterId: string; value: number }) => number;
}>;

/** The device type's declared descriptor law, for the built-ins the engine builds. */
type BuiltinParameterHalf = Readonly<{
    accepts: (input: { deviceType: string; paramId: string }) => boolean;
    clamp: (input: { deviceType: string; paramId: string; value: number }) => number;
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

/** The device project truth records for each device on these strips, by device id. */
function deviceByDeviceId(stripTracks: readonly Track[]): ReadonlyMap<string, Device> {
    return new Map(
        stripTracks.flatMap((track) => track.devices.map((device): [string, Device] => [device.id, device]))
    );
}

/**
 * Whether a carried built-in lane may stamp this parameter, given the seam
 * already answered `builtin !== null`.
 *
 * The presence check mirrors `deviceAcceptsAutomationParameter`
 * (`Transport/useCases/scheduling/applyAutomation/applyAutomation.ts`): a key
 * must already sit on the device before either law is asked, because the
 * descriptor law fails open on a name its descriptor never declares — Knead's
 * own descriptor declares no parameters, so the law alone would admit any id a
 * lane can spell. The body's own vocabulary
 * (`nativeBuiltinBody(...).addressesParameter`) is the second gate: it is what
 * decides whether the engine can resolve the name at all, and one
 * unresolvable name refuses the whole `write-device-parameter` batch. Only
 * once both hold is the declared law itself consulted.
 */
function builtinResolvesParameter(input: {
    device: Device | undefined;
    deviceType: string;
    parameterId: string;
    builtin: BuiltinParameterHalf;
}): boolean {
    const { device, deviceType, parameterId, builtin } = input;
    if (!device) {
        return false;
    }
    if (device.parameterValues[parameterId] === undefined) {
        return false;
    }
    if (!nativeBuiltinBody(deviceType)?.addressesParameter(parameterId)) {
        return false;
    }
    return builtin.accepts({ deviceType, paramId: parameterId });
}

/**
 * The two halves of the seam, and the one law the projection is held to.
 *
 * `quantiseValue` is the declared *type* law and belongs to both halves: it is
 * asked of the device type, which every family has. Without it neither family
 * can be admitted, because the value stamped would be one nothing had held to
 * the parameter's declared grain.
 */
function liveDeviceParameterLaw(stripTracks: readonly Track[]): {
    law: OfflineDeviceAutomationLaw;
    hosted: HostedParameterHalf | null;
    builtin: BuiltinParameterHalf | null;
} {
    const { acceptsExternalPluginParameter, clampExternalPluginValue, isAutomatable, clampValue, quantiseValue } =
        offlineDeviceParameterLawState;
    const refused = { law: REFUSE_DEVICE_AUTOMATION, hosted: null, builtin: null };
    if (!quantiseValue) {
        return refused;
    }
    const hosted: HostedParameterHalf | null =
        acceptsExternalPluginParameter && clampExternalPluginValue
            ? { accepts: acceptsExternalPluginParameter, clamp: clampExternalPluginValue }
            : null;
    const builtin: BuiltinParameterHalf | null =
        isAutomatable && clampValue ? { accepts: isAutomatable, clamp: clampValue } : null;
    if (!hosted && !builtin) {
        return refused;
    }

    const instances = instanceIdByDeviceId(stripTracks);
    const devices = deviceByDeviceId(stripTracks);
    return {
        hosted,
        builtin,
        law: {
            // Which family answers is decided by what the device is, exactly as
            // the engine's own mapper decides it: a device that resolves to an
            // instance is the plugin's to speak for, and anything else is a
            // built-in, admitted only where the device already holds the
            // parameter, the body resolves that id at all, and the declared law
            // accepts it — see `builtinResolvesParameter`.
            acceptsAutomation: ({ deviceId, deviceType, parameterId }) => {
                const externalInstanceId = instances.get(deviceId);
                if (externalInstanceId !== undefined) {
                    return hosted !== null && hosted.accepts(externalInstanceId, parameterId);
                }
                if (builtin === null) {
                    return false;
                }
                return builtinResolvesParameter({ device: devices.get(deviceId), deviceType, parameterId, builtin });
            },
            clampValue: ({ deviceId, deviceType, paramId, value }) => {
                const externalInstanceId = instances.get(deviceId);
                if (externalInstanceId !== undefined) {
                    return hosted === null ? value : hosted.clamp({ externalInstanceId, parameterId: paramId, value });
                }
                return builtin === null ? value : builtin.clamp({ deviceType, paramId, value });
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
 * Re-address a stamped built-in parameter under the name its body answers to
 * (see the header). Every other entry is returned untouched: a strip position
 * and a hosted parameter already travel in the vocabulary the engine resolves.
 */
function addressedNatively(
    entry: LiveAutomationWritesEntry,
    devices: ReadonlyMap<string, Device>
): LiveAutomationWritesEntry {
    if (entry.target.kind !== 'device-parameter') {
        return entry;
    }
    const device = devices.get(entry.target.deviceId);
    const body = device === undefined ? null : nativeBuiltinBody(device.type);
    if (!body) {
        return entry;
    }
    return { ...entry, target: { ...entry.target, parameterId: body.parameterName(entry.target.parameterId) } };
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

    const defaultTempo = transportStore.value?.tempo ?? 120;
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

    const { law, hosted, builtin } = liveDeviceParameterLaw(stripTracks);
    const trackById = new Map(stripTracks.map((track): [string, Track] => [track.id, track]));

    const projected = projectLiveAutomationWrites({
        stripTracks,
        lanes: automationStore.value?.lanes ?? [],
        regionStartSeconds,
        regionEndSeconds,
        defaultTempo,
        changes,
        projectBeatToSeconds,
        sampleRate,
        compensationDelaySeconds: getCompensationDelay,
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

    const devices = deviceByDeviceId(stripTracks);
    return { ...projected, entries: projected.entries.map((entry) => addressedNatively(entry, devices)) };
}
