import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';

/** Dims a hidden channel's strip while the session shows hidden tracks. */
export function getHiddenChannelClass(hidden: boolean): string {
    return hidden ? 'opacity-50' : '';
}

export const HiddenChannelBadge = ({ hidden, trackId }: { hidden: boolean; trackId: string }): ReactElement | null => {
    if (!hidden) {
        return null;
    }
    return (
        <DawMicroBadge className="uppercase" data-testid={`channel-hidden-${trackId}`}>
            Hidden
        </DawMicroBadge>
    );
};
