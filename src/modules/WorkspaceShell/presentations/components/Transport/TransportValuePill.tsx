import { type ButtonHTMLAttributes, type ReactElement } from 'react';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type TransportValuePillProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
};

export const TransportValuePill = ({
    active = false,
    className,
    children,
    ...props
}: TransportValuePillProps): ReactElement => (
    <Button
        variant="bare"
        size="bare"
        type="button"
        className={cn(
            'flex h-5 w-4 items-center justify-center rounded-sm text-[10px] font-bold tabular-nums transition-colors hover:bg-white/[0.06]',
            active ? 'text-[var(--color-accent-cyan)]' : 'text-muted-foreground/70',
            className
        )}
        {...props}
    >
        {children}
    </Button>
);
