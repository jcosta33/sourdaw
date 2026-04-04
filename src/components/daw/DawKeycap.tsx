import { type ComponentProps, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DawKeycapProps = ComponentProps<'kbd'> & {
    compact?: boolean;
};

export const DawKeycap = ({
    compact = false,
    className,
    children,
    ...props
}: DawKeycapProps): ReactElement => (
    <kbd
        className={cn(
            'inline-flex min-w-[20px] items-center justify-center rounded border border-border bg-surface-overlay px-1.5 font-mono text-[10px] text-muted-foreground',
            compact ? 'py-0.5' : 'py-1',
            className
        )}
        {...props}
    >
        {children}
    </kbd>
);
