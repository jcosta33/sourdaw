import { type ReactElement } from 'react';

import { Loader2 } from 'lucide-react';

import { useStore } from '#/infra/store/useStore';
import { levainStore, type LevainState } from '#/modules/Levain/stores';

import { type Track } from '../../../models/Track';

type Props = {
    track: Track;
};

const defaultLevainState: LevainState = {
    patch: {} as LevainState['patch'],
    uiLevel: 1,
    engineReady: false,
    sampleLoadProgress: null,
    activeVoices: 0,
    peakL: 0,
    peakR: 0,
    currentArticulationDisplay: 'Long',
};

export const LevainLoadingSpinner = ({ track }: Props): ReactElement | null => {
    // Only bother checking if this track actually has a levain device
    const isLevainTrack = track.devices.some((data: any) => data.type === 'levain');

    // We only subscribe if it's a levain track to avoid unnecessary re-renders on pure audio tracks
    const levainState = useStore(levainStore, defaultLevainState);
    const progress = levainState.sampleLoadProgress;
    const isLoading = isLevainTrack && progress !== null && progress !== undefined;

    if (!isLoading) {
        return null;
    }

    return (
        <Loader2
            className="size-3 shrink-0 text-[var(--color-accent-amber)] animate-spin"
            aria-hidden="true"
            aria-label="Loading Orchestral Samples"
        />
    );
};
