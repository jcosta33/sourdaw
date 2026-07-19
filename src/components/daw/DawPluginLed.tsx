import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawPluginLedProps = HTMLAttributes<HTMLDivElement> & {
    tone?:
        'amber' | 'peach' | 'cyan' | 'mint' | 'lavender' | 'danger' | 'neutral' | 'rose' | 'indigo' | 'sage' | 'copper';
};

const TONE_CLASS_NAMES: Record<NonNullable<DawPluginLedProps['tone']>, string> = {
    amber: 'border-[var(--color-accent-amber)]/35 bg-[linear-gradient(180deg,rgba(196,170,95,0.24),rgba(196,170,95,0.1))] text-[var(--color-accent-amber)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_24px_rgba(196,170,95,0.08)]',
    peach: 'border-[var(--color-accent-peach)]/34 bg-[linear-gradient(180deg,rgba(201,160,122,0.24),rgba(201,160,122,0.1))] text-[var(--color-accent-peach)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(201,160,122,0.08)]',
    cyan: 'border-[var(--color-accent-cyan)]/30 bg-[linear-gradient(180deg,rgba(127,184,196,0.22),rgba(127,184,196,0.08))] text-[var(--color-accent-cyan)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(127,184,196,0.08)]',
    mint: 'border-[var(--color-accent-mint)]/30 bg-[var(--color-accent-mint)]/12 text-[var(--color-accent-mint)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(125,184,160,0.08)]',
    lavender:
        'border-[var(--color-accent-lavender)]/30 bg-[var(--color-accent-lavender)]/12 text-[var(--color-accent-lavender)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(168,155,196,0.08)]',
    danger: 'border-[var(--color-state-danger)]/30 bg-[var(--color-state-danger)]/12 text-[var(--color-state-danger)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(196,64,48,0.08)]',
    neutral: 'border-white/10 bg-white/5 text-white/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
    rose: 'border-[var(--color-accent-rose)]/30 bg-[var(--color-accent-rose)]/12 text-[var(--color-accent-rose)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(192,96,112,0.08)]',
    indigo: 'border-[var(--color-accent-indigo)]/30 bg-[var(--color-accent-indigo)]/12 text-[var(--color-accent-indigo)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(74,96,160,0.08)]',
    sage: 'border-[var(--color-accent-sage)]/30 bg-[var(--color-accent-sage)]/12 text-[var(--color-accent-sage)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(138,168,138,0.08)]',
    copper: 'border-[var(--color-accent-copper)]/30 bg-[var(--color-accent-copper)]/12 text-[var(--color-accent-copper)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(184,136,104,0.08)]',
};

export const DawPluginLed = ({ tone = 'amber', className, children, ...props }: DawPluginLedProps): ReactElement => (
    <div
        className={cn(
            'inline-flex items-center gap-1 rounded-full border px-[0.5rem] py-[0.24rem] text-[0.56rem] uppercase tracking-[0.16em]',
            TONE_CLASS_NAMES[tone],
            className
        )}
        {...props}
    >
        {children}
    </div>
);
