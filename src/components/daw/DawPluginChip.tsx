import { type ButtonHTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawPluginChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    active?: boolean;
    tone?: 'neutral' | 'amber' | 'cyan' | 'peach' | 'lavender' | 'mint' | 'steel' | 'danger' | 'rose' | 'indigo' | 'sage' | 'copper';
    size?: 'xs' | 'sm';
    shape?: 'pill' | 'soft';
    caps?: boolean;
};

const ACTIVE_TONE_CLASS_NAMES: Record<NonNullable<DawPluginChipProps['tone']>, string> = {
    neutral: 'border-white/18 bg-white/6 text-white/88',
    amber: 'border-[var(--color-accent-amber)]/60 bg-[var(--color-accent-amber)]/14 text-[var(--color-accent-amber)]',
    cyan: 'border-[var(--color-accent-cyan)]/60 bg-[var(--color-accent-cyan)]/12 text-[var(--color-accent-cyan)]',
    peach: 'border-[var(--color-accent-peach)]/60 bg-[var(--color-accent-peach)]/12 text-[var(--color-accent-peach)]',
    lavender:
        'border-[var(--color-accent-lavender)]/60 bg-[var(--color-accent-lavender)]/12 text-[var(--color-accent-lavender)]',
    mint: 'border-[var(--color-accent-mint)]/60 bg-[var(--color-accent-mint)]/12 text-[var(--color-accent-mint)]',
    steel: 'border-[var(--color-accent-steel)]/60 bg-[var(--color-accent-steel)]/14 text-[var(--color-accent-steel)]',
    danger: 'border-[var(--color-state-danger)]/60 bg-[var(--color-state-danger)]/12 text-[var(--color-state-danger)]',
    rose: 'border-[var(--color-accent-rose)]/60 bg-[var(--color-accent-rose)]/14 text-[var(--color-accent-rose)]',
    indigo: 'border-[var(--color-accent-indigo)]/60 bg-[var(--color-accent-indigo)]/12 text-[var(--color-accent-indigo)]',
    sage: 'border-[var(--color-accent-sage)]/60 bg-[var(--color-accent-sage)]/12 text-[var(--color-accent-sage)]',
    copper: 'border-[var(--color-accent-copper)]/60 bg-[var(--color-accent-copper)]/12 text-[var(--color-accent-copper)]',
};

const SIZE_CLASS_NAMES: Record<NonNullable<DawPluginChipProps['size']>, string> = {
    xs: 'px-1.5 py-0.5 text-[7px]',
    sm: 'px-3 py-1 text-[10px]',
};

const SHAPE_CLASS_NAMES: Record<NonNullable<DawPluginChipProps['shape']>, string> = {
    pill: 'rounded-full',
    soft: 'rounded-[14px]',
};

export const DawPluginChip = ({
    active = false,
    tone = 'neutral',
    size = 'xs',
    shape = 'pill',
    caps = true,
    className,
    type = 'button',
    children,
    ...props
}: DawPluginChipProps): ReactElement => (
    <button
        type={type}
        className={cn(
            'inline-flex items-center justify-center border font-medium transition-[background-color,border-color,color,box-shadow]',
            'disabled:pointer-events-none disabled:opacity-45',
            SIZE_CLASS_NAMES[size],
            SHAPE_CLASS_NAMES[shape],
            caps ? 'uppercase tracking-[0.18em]' : '',
            active
                ? ACTIVE_TONE_CLASS_NAMES[tone]
                : 'border-white/8 bg-black/20 text-white/52 hover:border-white/14 hover:text-white/84',
            className
        )}
        {...props}
    >
        {children}
    </button>
);
