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

import { offlineDeviceParameterLawState } from '../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';
import { type StripAutomationDeviceEntry } from '../offlineRender/projectStripAutomationWrites';

import { carriedEngineHostedStripIds } from './carriedEngineHostedStripIds';
import { isDeviceCarriedByNativeSession } from './isDeviceCarriedByNativeSession';
import { nativeBuiltinAutomation } from './nativeBuiltinAutomation';
import { nativeBuiltinBody } from './nativeBuiltinBodies';
import { nativeDeviceParameterLaw } from './nativeDeviceParameterLaw';
import { nativeLiveGraphSession } from './nativeLiveGraphSessionState';
import { projectLiveAutomationWrites, type LiveAutomationWrites } from './projectLiveAutomationWrites';

/** What a session with no clock to place automation on holds. */
const NO_AUTOMATION: LiveAutomationWrites = { entries: [], exclusions: [] };

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
    const { law, hosted } = nativeDeviceParameterLaw({ source: offlineDeviceParameterLawState, stripTracks, builtin });
    const trackById = new Map(stripTracks.map((track): [string, Track] => [track.id, track]));
    const hostedStripIds = carriedEngineHostedStripIds(nativeLiveGraphSession.carriedStripIds, stripTracks);

    const projected = projectLiveAutomationWrites({
        stripTracks,
        lanes: automationStore.value?.lanes ?? [],
        regionStartSeconds,
        regionEndSeconds,
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
