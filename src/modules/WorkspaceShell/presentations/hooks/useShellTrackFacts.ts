import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore } from '#/modules/Arrangement/stores';
import { detectVariationLaneEnabling, hasVariationLanes } from '#/modules/Arrangement/useCases';

import { isSameVariationLanesShown } from '../helpers/variationLanesShown';

/**
 * The three facts the shell reads from the tracks. Following the whole store would render the
 * whole chrome again for every clip edit, so each fact is its own narrow selection.
 */
export const useShellTrackFacts = (selectedClipId: string | null) => {
    const isAudioClipSelected = useStoreSelector(
        trackStore,
        (state) =>
            selectedClipId !== null &&
            (state?.tracks ?? []).some((track) =>
                track.clips.some((clip) => clip.id === selectedClipId && clip.type === 'audio')
            )
    );
    const takesTabAvailable = useStoreSelector(trackStore, (state) => hasVariationLanes(state?.tracks ?? []));
    const variationLanesShown = useStoreSelector(
        trackStore,
        (state) => detectVariationLaneEnabling(null, state?.tracks ?? []).shown,
        isSameVariationLanesShown
    );
    return { isAudioClipSelected, takesTabAvailable, variationLanesShown };
};
