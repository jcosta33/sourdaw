import { setTrackState } from '#/modules/Arrangement/useCases';
import { addSidechainRoute } from '#/modules/Routing/useCases';
import { ensureTrackStrips } from '#/modules/Transport/useCases';

import { syncArrangement } from '../../demoProjects/demoUtils/syncArrangement';
import { projectLoadEpoch } from '../../projectPersistence/helpers/runProjectLoadTransaction';

import { commitVcaGroups } from './commitVcaGroups';
import { reportDeviceReadinessWhenSettled } from './reportDeviceReadiness';

import type { Track } from '#/modules/Arrangement/stores';
import type { VcaGroupHandle } from './createVca';

type FinalizeTemplateInput = {
    tracks: Track[];
    selectTrackId?: string | null;
    vcaGroups?: VcaGroupHandle[];
    sidechainRoutes?: Array<{ trigger: Track; target: Track; deviceId: string; parameterId?: string }>;
};

export async function finalizeTemplate(input: FinalizeTemplateInput): Promise<void> {
    let committedTracks = input.tracks;
    if (input.vcaGroups && input.vcaGroups.length > 0) {
        committedTracks = commitVcaGroups({
            handles: input.vcaGroups,
            tracks: input.tracks,
            selectedTrackId: input.selectTrackId ?? null,
        });
    } else {
        setTrackState({
            tracks: input.tracks,
            selectedTrackId: input.selectTrackId ?? null,
        });
    }

    syncArrangement(committedTracks);

    for (const route of input.sidechainRoutes ?? []) {
        addSidechainRoute(route.trigger.id, route.target.id, route.deviceId, route.parameterId ?? 'sc-comp-threshold');
    }

    ensureTrackStrips();

    const originatingEpoch = projectLoadEpoch.current;
    const { waitForDevices } = await import('#/modules/AudioEngine/useCases');
    // Content readiness continues behind the workspace: the project and its
    // graph are committed above, and a progressing Levain admission refreshes
    // the wait's own inactivity deadline for as long as it uploads. Holding this
    // action for that would keep the launch overlay up with it, so report the
    // cohort's failures when it settles instead.
    reportDeviceReadinessWhenSettled(waitForDevices(), originatingEpoch);
}
