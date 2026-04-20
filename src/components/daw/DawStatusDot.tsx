import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawStatusDotTone = 'muted' | 'success' | 'warning' | 'danger' | 'primary' | 'cyan' | 'peach';

type DawStatusDotProps = HTMLAttributes<HTMLSpanElement> & {
    tone?: DawStatusDotTone;
    pulse?: boolean;
};

const TONE_CLASS_NAMES: Record<DawStatusDotTone, string> = {
    muted: 'bg-muted-foreground/50',
    success: 'bg-[var(--color-state-success)]',
    warning: 'bg-[var(--color-state-warning)]',
    danger: 'bg-[var(--color-state-danger)]',
    primary: 'bg-primary',
    cyan: 'bg-[var(--color-accent-cyan)]',
    peach: 'bg-[var(--color-accent-peach)]',
};

export const getDawStatusDotClassName = ({
    tone = 'muted',
    pulse = false,
    className,
}: {
    tone?: DawStatusDotTone;
    pulse?: boolean;
    className?: string;
} = {}): string =>
    cn('size-1.5 rounded-full shrink-0', pulse ? 'animate-pulse' : '', TONE_CLASS_NAMES[tone], className);

export const DawStatusDot = ({
    tone = 'muted',
    pulse = false,
    className,
    ...props
}: DawStatusDotProps): ReactElement => (
    <span className={getDawStatusDotClassName({ tone, pulse, className })} {...props} />
);
