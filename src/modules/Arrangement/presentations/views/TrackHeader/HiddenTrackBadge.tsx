import { type ReactElement } from 'react';

import { DawMicroBadge } from '#/components/daw/DawMicroBadge';

/** Marks a hidden track while the session shows hidden tracks, so it can be found and shown again. */
export const HiddenTrackBadge = (): ReactElement => (
    <DawMicroBadge data-testid="track-hidden-badge" className="ml-1 uppercase">
        Hidden
    </DawMicroBadge>
);
