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
 * A hosted plugin parameter is admitted only where all three of these hold
 * (#3568): the session claimed the strip, the engine reports the device in the
 * chain it actually built, and the device resolves to a plugin instance. Any
 * one missing means Web Audio is still driving that parameter over IPC, and
 * admitting it here would drive one plugin from both engines at once.
 *
 * The law those parameters are held to is Arrangement's own, reached through
 * the composition-root seam (`offlineDeviceParameterLawState`) for the reason
 * that seam exists: an AudioEngine → `Arrangement/useCases` import inverts the
 * dependency and closes a module cycle. An unset seam admits no device at all,
 * which is the seam's own contract — unset means no law was injected, not
 * "anything goes".
 */

import { deriveVcaMultiplier, getVcaGroupsState, type Track } from '#/modules/Arrangement/stores';
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
import { projectLiveAutomationWrites, type LiveAutomationWrites } from './projectLiveAutomationWrites';

/** What a session with no clock to place automation on holds. */
const NO_AUTOMATION: LiveAutomationWrites = { entries: [], exclusions: [] };

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
 * Arrangement's hosted-plugin law, as the device-parameter law this projection
 * takes. `null` while any half of the seam is unset.
 */
function hostedDeviceParameterLaw(stripTracks: readonly Track[]): OfflineDeviceAutomationLaw | null {
    const { acceptsExternalPluginParameter, clampExternalPluginValue, quantiseValue } = offlineDeviceParameterLawState;
    if (!acceptsExternalPluginParameter || !clampExternalPluginValue || !quantiseValue) {
        return null;
    }
    const instances = instanceIdByDeviceId(stripTracks);
    return {
        acceptsAutomation: ({ deviceId, parameterId }) => {
            const externalInstanceId = instances.get(deviceId);
            return externalInstanceId !== undefined && acceptsExternalPluginParameter(externalInstanceId, parameterId);
        },
        clampValue: ({ deviceId, paramId, value }) => {
            const externalInstanceId = instances.get(deviceId);
            return externalInstanceId === undefined
                ? value
                : clampExternalPluginValue({ externalInstanceId, parameterId: paramId, value });
        },
        // Identity for `external-plugin` today, and read from the seam rather
        // than assumed so a declared type law arriving for the family reaches
        // the stamped value the same tick it reaches the tick path's.
        quantiseValue: ({ deviceType, paramId, value }) => quantiseValue({ deviceType, paramId, value }),
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

    const deviceParameterLaw = hostedDeviceParameterLaw(stripTracks);
    const trackById = new Map(stripTracks.map((track): [string, Track] => [track.id, track]));

    return projectLiveAutomationWrites({
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
            return deviceParameterLaw && track ? carriedHostedDevices(track) : [];
        },
        deviceParameterLaw: deviceParameterLaw ?? REFUSE_DEVICE_AUTOMATION,
    });
}
