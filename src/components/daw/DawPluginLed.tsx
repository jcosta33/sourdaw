import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DawPluginLedProps = HTMLAttributes<HTMLDivElement> & {
    tone?: 'amber' | 'peach' | 'cyan' | 'mint' | 'lavender' | 'danger' | 'neutral';
};

const TONE_CLASS_NAMES: Record<NonNullable<DawPluginLedProps['tone']>, string> = {
    amber:
        'border-[rgba(229,168,75,0.35)] bg-[linear-gradient(180deg,rgba(229,168,75,0.24),rgba(229,168,75,0.1))] text-[var(--color-accent-amber)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_24px_rgba(229,168,75,0.08)]',
    peach:
        'border-[rgba(201,160,122,0.34)] bg-[linear-gradient(180deg,rgba(201,160,122,0.24),rgba(201,160,122,0.1)),linear-gradient(90deg,rgba(196,64,48,0.05),transparent)] text-[var(--color-accent-peach)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(201,160,122,0.08)]',
    cyan:
        'border-[rgba(127,184,196,0.3)] bg-[linear-gradient(180deg,rgba(127,184,196,0.22),rgba(127,184,196,0.08)),linear-gradient(90deg,rgba(193,143,163,0.08),transparent)] text-[var(--color-accent-cyan)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(127,184,196,0.08)]',
    mint:
        'border-[var(--color-accent-mint)]/30 bg-[var(--color-accent-mint)]/12 text-[var(--color-accent-mint)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(82,186,70,0.08)]',
    lavender:
        'border-[var(--color-accent-lavender)]/30 bg-[var(--color-accent-lavender)]/12 text-[var(--color-accent-lavender)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(149,78,178,0.08)]',
    danger:
        'border-[var(--color-state-danger)]/30 bg-[var(--color-state-danger)]/12 text-[var(--color-state-danger)] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_0_20px_rgba(196,64,48,0.08)]',
    neutral:
        'border-white/10 bg-white/5 text-white/62 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]',
};

export const DawPluginLed = ({
    tone = 'amber',
    className,
    children,
    ...props
}: DawPluginLedProps): ReactElement => (
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
