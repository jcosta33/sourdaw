import { setTrackState } from '#/modules/Arrangement/useCases';
import { addSidechainRoute } from '#/modules/Routing/useCases';
import { ensureTrackStrips } from '#/modules/Transport/useCases';

import { syncArrangement } from '../../demoProjects/demoUtils/syncArrangement';

import { commitVcaGroups } from './commitVcaGroups';

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

    ensureTrackStrips();

    const { waitForDevices } = await import('#/modules/AudioEngine/useCases');
    await waitForDevices();

    for (const route of input.sidechainRoutes ?? []) {
        addSidechainRoute(route.trigger.id, route.target.id, route.deviceId, route.parameterId ?? 'sc-comp-threshold');
    }
}
