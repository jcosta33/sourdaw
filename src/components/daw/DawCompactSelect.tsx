import { type ComponentProps, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawCompactSelectProps = Omit<ComponentProps<'select'>, 'size'> & {
    size?: 'micro' | 'sm';
    tone?: 'overlay' | 'inset';
    align?: 'left' | 'center' | 'right';
};

const SIZE_CLASS_NAMES: Record<NonNullable<DawCompactSelectProps['size']>, string> = {
    micro: 'h-5 rounded px-1 text-[9px]',
    sm: 'h-6 rounded-sm px-2 py-1 text-xs',
};

const TONE_CLASS_NAMES: Record<NonNullable<DawCompactSelectProps['tone']>, string> = {
    overlay: 'border-border/50 bg-surface-overlay hover:bg-surface-raised/70',
    inset: 'border-border-soft bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] hover:bg-surface-slot/80',
};

const ALIGN_CLASS_NAMES: Record<NonNullable<DawCompactSelectProps['align']>, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
};

export const DawCompactSelect = ({
    size = 'sm',
    tone = 'overlay',
    align = 'left',
    className,
    children,
    ...props
}: DawCompactSelectProps): ReactElement => (
    <select
        className={cn(
            'cursor-pointer border text-foreground outline-none transition-[background-color,border-color,box-shadow,color]',
            'focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50',
            SIZE_CLASS_NAMES[size],
            TONE_CLASS_NAMES[tone],
            ALIGN_CLASS_NAMES[align],
            className
        )}
        {...props}
    >
        {children}
    </select>
);
