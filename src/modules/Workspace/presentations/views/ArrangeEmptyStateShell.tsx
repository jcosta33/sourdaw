import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type ArrangeEmptyStateShellProps = HTMLAttributes<HTMLDivElement> & {
    active?: boolean;
};

export const ArrangeEmptyStateShell = ({
    active = false,
    className,
    children,
    ...props
}: ArrangeEmptyStateShellProps): ReactElement => (
    <div
        className={cn(
            'mx-4 flex w-full max-w-xs flex-col items-center gap-4 rounded-2xl border p-7 shadow-[0_8px_32px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-300',
            active
                ? 'scale-[1.02] border-2 border-[var(--color-accent-orange)] bg-[var(--color-accent-orange)]/5'
                : 'border-border-soft/40 bg-surface-overlay/70 backdrop-blur-xl',
            className
        )}
        {...props}
    >
        {children}
    </div>
);
