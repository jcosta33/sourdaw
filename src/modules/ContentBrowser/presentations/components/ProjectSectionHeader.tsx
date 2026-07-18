import { type ReactElement } from 'react';

import { DawHeaderBand } from '#/components/daw/DawHeaderBand';

/** Section header with subtle border. Used by the Project browser tab. */
export const SectionHeader = ({ title }: { title: string }): ReactElement => (
    <DawHeaderBand compact className="mb-2 rounded-sm" title={title} />
);
