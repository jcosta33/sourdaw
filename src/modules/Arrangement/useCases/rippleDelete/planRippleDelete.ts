import { workspaceStore } from '#/modules/WorkspaceShell/stores';

import { type Clip } from '../../models/Track';
import { deriveRippleDelete } from '../../services/deriveRippleDelete';
import { getTrackStoreState } from '../getTrackStoreState';

type PlanRippleDeleteInput = {
    trackId: string;
    clipIds: string[];
};

export type PlanRippleDeleteOutput = ReturnType<typeof deriveRippleDelete<Clip>>;

export function planRippleDelete({ trackId, clipIds }: PlanRippleDeleteInput): PlanRippleDeleteOutput {
    const track = getTrackStoreState()?.tracks.find((candidateTrack) => candidateTrack.id === trackId);
    if (!track) {
        return null;
    }
    return deriveRippleDelete({
        clips: track.clips,
        clipIds,
        rippleEnabled: workspaceStore.value?.rippleEditing ?? false,
    });
}
