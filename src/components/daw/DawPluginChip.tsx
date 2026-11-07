import { type ButtonHTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawPluginChipProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    /**
     * Declares a selection state: both `true` and `false` render
     * `aria-pressed`. Omit it for a one-shot action so the chip stays a plain
     * button; an explicit caller `aria-pressed` still wins.
     */
    active?: boolean;
    tone?:
        | 'neutral'
        | 'amber'
        | 'cyan'
        | 'peach'
        | 'lavender'
        | 'mint'
        | 'steel'
        | 'danger'
        | 'rose'
        | 'indigo'
        | 'sage'
        | 'copper';
    size?: 'xs' | 'sm';
    shape?: 'pill' | 'soft';
    caps?: boolean;
};

const ACTIVE_TONE_CLASS_NAMES: Record<NonNullable<DawPluginChipProps['tone']>, string> = {
    neutral: 'border-border-active bg-surface-raised/60 text-text-primary',
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
    xs: 'min-h-6 px-2 py-0.5',
    sm: 'min-h-6 px-3 py-1',
};

const SIZE_FONT_SIZES: Record<NonNullable<DawPluginChipProps['size']>, string> = {
    xs: 'var(--text-metadata)',
    sm: 'var(--text-label)',
};

const SHAPE_CLASS_NAMES: Record<NonNullable<DawPluginChipProps['shape']>, string> = {
    pill: 'rounded-full',
    soft: 'rounded-[14px]',
};

/**
 * Whether the caller has marked this chip inert with `aria-disabled`.
 *
 * A chip that a device's current mode makes inert is expressed with
 * `aria-disabled` rather than the native attribute — deliberately, so it stays
 * focusable and a keyboard user can still reach the `title` explaining itself
 * (`ProofChamberPanel`'s `GatedChip` states the reasoning). The cost of that
 * choice was invisible until it was measured: the disabled styling below was
 * keyed on the **native** attribute alone, so every `aria-disabled` chip in the
 * app rendered pixel-identical to a live one, kept its hover states, and
 * swallowed clicks in silence. The Dutch Oven has shipped that way since #1519.
 *
 * The attribute is `Booleanish`, so `"false"` has to be excluded rather than
 * merely testing for presence.
 */
function isAriaDisabled(value: DawPluginChipProps['aria-disabled']): boolean {
    return value === true || value === 'true';
}

export const DawPluginChip = ({
    active,
    tone = 'neutral',
    size = 'xs',
    shape = 'pill',
    caps = true,
    className,
    style,
    type = 'button',
    children,
    ...props
}: DawPluginChipProps): ReactElement => {
    const inert = isAriaDisabled(props['aria-disabled']);
    return (
        <button
            type={type}
            aria-pressed={active}
            style={{ fontSize: SIZE_FONT_SIZES[size], ...style }}
            className={cn(
                'inline-flex items-center justify-center border font-medium transition-[background-color,border-color,color,box-shadow]',
                'disabled:pointer-events-none disabled:opacity-45',
                SIZE_CLASS_NAMES[size],
                SHAPE_CLASS_NAMES[shape],
                caps ? 'uppercase tracking-[0.18em]' : '',
                active ? ACTIVE_TONE_CLASS_NAMES[tone] : 'border-border-soft bg-surface-well/50 text-text-secondary',
                // Hover feedback is a promise that the control will respond, so
                // an inert chip must not make it. Chosen here rather than with
                // an `aria-disabled:hover:` variant because two variants of the
                // same property resolve by stylesheet order, not by class-list
                // order, and this has to win.
                !active && !inert ? 'hover:border-border-active hover:text-text-primary' : '',
                // Not `pointer-events-none`: the reason lives in `title`, and
                // suppressing pointer events would take the explanation away
                // with the interactivity.
                inert ? 'cursor-not-allowed opacity-45' : '',
                className
            )}
            {...props}
        >
            {children}
        </button>
    );
};
