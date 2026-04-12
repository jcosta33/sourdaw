import { type HTMLAttributes, type ReactElement } from 'react';
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
    <div
        className={cn(
            'daw-display-surface flex items-center justify-center rounded-md p-3',
            accentTop ? 'border-t-[var(--color-light-edge)]' : '',
            className
        )}
        {...props}
    >
        {children}
    </div>
);
