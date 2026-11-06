import { type ReactElement, type ReactNode } from 'react';

import { DawSectionDivider } from '#/components/daw/DawSectionDivider';
import { Stack } from '#/components/layout';

/**
 * The only place a browser route (Instruments and Effects tabs, their
 * drill-downs and search results) chooses its inset and vertical rhythm.
 * Route content and its cards add no outer margin or horizontal padding, so
 * every route reads the same and a new route cannot pick its own spacing.
 */
export const BrowserRouteBody = ({ children }: { children: ReactNode }): ReactElement => (
    <Stack gap={1.5} className="px-1.5 pt-1.5 pb-4" data-testid="browser-route-body">
        {children}
    </Stack>
);

type BrowserRouteSectionProps = {
    label: ReactNode;
    startSlot?: ReactNode;
    labelClassName?: string;
    lineClassName?: string;
    children: ReactNode;
};

/** A labelled group of cards, set off from the previous group by one shared gap. */
export const BrowserRouteSection = ({
    label,
    startSlot,
    labelClassName,
    lineClassName,
    children,
}: BrowserRouteSectionProps): ReactElement => (
    <Stack gap={1.5} className="mt-2.5 first:mt-0">
        <DawSectionDivider
            label={label}
            startSlot={startSlot}
            labelClassName={labelClassName}
            lineClassName={lineClassName}
        />
        {children}
    </Stack>
);

/** Trailing, ruled-off content such as the plugin browser or a shortcut row. */
export const BrowserRouteFooter = ({ children }: { children: ReactNode }): ReactElement => (
    <div className="mt-1.5 border-t border-border/20 pt-2">{children}</div>
);
