import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/helpers/Styles/cn';

type DawDialogFooterProps = HTMLAttributes<HTMLDivElement> & {
    tone?: 'neutral' | 'warm';
    align?: 'start' | 'between' | 'end';
};

const ALIGN_CLASS_NAMES: Record<NonNullable<DawDialogFooterProps['align']>, string> = {
    start: 'justify-start',
    between: 'justify-between',
    end: 'justify-end',
};

const TONE_CLASS_NAMES: Record<NonNullable<DawDialogFooterProps['tone']>, string> = {
    neutral:
        'border-t border-white/8 bg-surface-base/45 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]',
    warm: 'border-t border-orange-900/30 bg-stone-950/55 shadow-[inset_0_1px_0_rgba(251,146,60,0.06)]',
};

export const DawDialogFooter = ({
    tone = 'neutral',
    align = 'between',
    className,
    children,
    ...props
}: DawDialogFooterProps): ReactElement => (
    <div
        className={cn(
            'flex items-center gap-2 px-4 py-3',
            ALIGN_CLASS_NAMES[align],
            TONE_CLASS_NAMES[tone],
            className
        )}
        {...props}
    >
        {children}
    </div>
);
