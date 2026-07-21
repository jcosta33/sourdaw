import { commitLegacyVcaTemplateState } from '#/modules/Arrangement/useCases';

import type { Track } from '#/modules/Arrangement/stores';
import type { VcaGroupHandle } from './createVca';

type CommitVcaGroupsInput = {
    handles: readonly VcaGroupHandle[];
    tracks: readonly Track[];
    selectedTrackId: string | null;
};

export function commitVcaGroups(input: CommitVcaGroupsInput): Track[] {
    return commitLegacyVcaTemplateState({
        tracks: input.tracks,
        selectedTrackId: input.selectedTrackId,
        groups: input.handles.map((handle) => ({
            id: handle.id,
            name: handle.name,
            gain: handle.gain,
            muted: handle.muted,
            memberTrackIds: handle.memberTrackIds,
        })),
    });
}
