import { type HTMLAttributes, type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawDisplaySurfaceProps = HTMLAttributes<HTMLDivElement> & {
    accentTop?: boolean;
};

export const DawDisplaySurface = ({
    accentTop = false,
    className,
    children,
    ...props
}: DawDisplaySurfaceProps): ReactElement => (
    <Row
        align="center"
        justify="center"
        className={cn(
            'daw-display-surface rounded-md p-3',
            accentTop ? 'border-t-[var(--color-light-edge)]' : '',
            className
        )}
        {...props}
    >
        {children}
    </Row>
);
