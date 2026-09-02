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
 */

import { deriveVcaMultiplier, getVcaGroupsState, type Track } from '#/modules/Arrangement/stores';
import { automationStore } from '#/modules/Automation/stores';
import { getAutomationLaneCeiling } from '#/modules/Automation/useCases';
import { defaultTransportState, tempoMapStore, transportStore } from '#/modules/Transport/stores';
import { automationSlewTickSecondsForGrain } from '#/utils/automationSlew';

import { offlinePpqEndpointProjectorState } from '../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { getCompensationDelay } from '../latencyCompensation/compensation/getCompensationDelay';

import { projectLiveAutomationWrites, type LiveAutomationWrites } from './projectLiveAutomationWrites';

/** What a session with no clock to place automation on holds. */
const NO_AUTOMATION: LiveAutomationWrites = { entries: [], exclusions: [] };

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
    });
}
