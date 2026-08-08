import { type HTMLAttributes, type ReactElement, type Ref } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawMicroBadgeProps = HTMLAttributes<HTMLSpanElement> & {
    tone?: 'muted' | 'primary' | 'cyan' | 'peach' | 'success' | 'danger';
    rounded?: 'sm' | 'full';
    /** React 19 passes `ref` as a plain prop; it forwards onto the span. */
    ref?: Ref<HTMLSpanElement>;
};

const TONE_CLASS_NAMES: Record<NonNullable<DawMicroBadgeProps['tone']>, string> = {
    muted: 'border-border/30 bg-surface-overlay/50 text-muted-foreground/65',
    primary: 'border-primary/30 bg-primary/12 text-primary',
    cyan: 'border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/12 text-[var(--color-accent-cyan)]',
    peach: 'border-[var(--color-accent-peach)]/30 bg-[var(--color-accent-peach)]/12 text-[var(--color-accent-peach)]',
    success:
        'border-[var(--color-state-success)]/30 bg-[var(--color-state-success)]/12 text-[var(--color-state-success)]',
    danger: 'border-[var(--color-state-danger)]/30 bg-[var(--color-state-danger)]/12 text-[var(--color-state-danger)]',
};

export const DawMicroBadge = ({
    tone = 'muted',
    rounded = 'sm',
    className,
    children,
    ...props
}: DawMicroBadgeProps): ReactElement => (
    <span
        className={cn(
            'inline-flex shrink-0 items-center gap-1 border px-1.5 py-0.5 text-[9px] font-medium leading-none',
            rounded === 'full' ? 'rounded-full' : 'rounded',
            TONE_CLASS_NAMES[tone],
            className
        )}
        {...props}
    >
        {children}
    </span>
);
