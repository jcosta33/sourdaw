import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';

/** Dims a hidden track's row while the session shows hidden tracks. */
export function getHiddenTrackRowClass(hidden: boolean): string {
    return hidden ? 'opacity-50' : '';
}

/** Marks a hidden track while the session shows hidden tracks, so it can be found and shown again. */
export const HiddenTrackBadge = ({ hidden }: { hidden: boolean }): ReactElement | null => {
    if (!hidden) {
        return null;
    }
    return (
        <DawMicroBadge data-testid="track-hidden-badge" className="ml-1 uppercase">
            Hidden
        </DawMicroBadge>
    );
};
