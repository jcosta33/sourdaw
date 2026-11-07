import { workspaceStore } from '#/modules/WorkspaceShell/stores';
import { type ClipSnapshot } from '#/utils/handlerContract';

import { type Clip } from '../../models/Track';
import { deriveRippleDelete } from '../../services/deriveRippleDelete';
import { getTrackStoreState } from '../getTrackStoreState';

type PlanRippleDeleteInput = {
    trackId: string;
    clipIds: string[];
    ripple?: boolean;
};

export type PlanRippleDeleteOutput = ReturnType<typeof deriveRippleDelete<Clip>>;

export function planRippleDelete(input: PlanRippleDeleteInput): PlanRippleDeleteOutput;
export function planRippleDelete<TClip extends ClipSnapshot>(
    input: PlanRippleDeleteInput,
    state: { tracks: readonly { id: string; clips: readonly TClip[] }[] }
): ReturnType<typeof deriveRippleDelete<TClip>>;
export function planRippleDelete(
    { trackId, clipIds, ripple }: PlanRippleDeleteInput,
    state: { tracks: readonly { id: string; clips: readonly ClipSnapshot[] }[] } | null = getTrackStoreState()
): ReturnType<typeof deriveRippleDelete<ClipSnapshot>> {
    const track = state?.tracks.find((candidateTrack) => candidateTrack.id === trackId);
    if (!track) {
        return null;
    }
    return deriveRippleDelete({
        clips: track.clips,
        clipIds,
        rippleEnabled: ripple ?? workspaceStore.value?.rippleEditing ?? false,
    });
}
