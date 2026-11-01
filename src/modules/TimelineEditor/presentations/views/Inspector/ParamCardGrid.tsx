import { type ReactElement, type ReactNode } from 'react';

import { Grid } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type ParamCardGridProps = {
    gap?: 2 | 4;
    className?: string;
    children: ReactNode;
};

/**
 * Device parameter cards, one per row until the Inspector column is wide enough
 * (24rem, the `@sm` container query declared by DeviceInspector) for two cards
 * to hold label, value, MIDI learn and automation without crowding.
 */
export const ParamCardGrid = ({ gap = 2, className, children }: ParamCardGridProps): ReactElement => (
    <Grid gap={gap} className={cn('grid-cols-1 @sm:grid-cols-2', className)}>
        {children}
    </Grid>
);
