import { type ReactElement, useSyncExternalStore } from 'react';
import { Loader2 } from 'lucide-react';
import { levainStore } from '#/modules/Levain/stores/levainStore';
import { type Track } from '../../models/Track';

type Props = {
    track: Track;
};

export const LevainLoadingSpinner = ({ track }: Props): ReactElement | null => {
    // Only bother checking if this track actually has a levain device
    const isLevainTrack = track.devices.some((d) => d.type === 'levain');
    
    // We only subscribe if it's a levain track to avoid unnecessary re-renders on pure audio tracks
    const isLoading = useSyncExternalStore(
        (cb) => {
            if (!isLevainTrack) return () => {};
            return levainStore.subscribe(cb);
        },
        () => {
            if (!isLevainTrack) return false;
            const progress = levainStore.value?.sampleLoadProgress;
            return progress !== null && progress !== undefined;
        }
    );

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
