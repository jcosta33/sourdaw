import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DawSideRailProps = HTMLAttributes<HTMLDivElement>;

export const DawSideRail = ({
    className,
    children,
    ...props
}: DawSideRailProps): ReactElement => (
    <div className={cn('daw-side-rail flex min-w-0 shrink-0 flex-col', className)} {...props}>
        {children}
    </div>
);
