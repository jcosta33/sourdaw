import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawUtilityNoticeProps = HTMLAttributes<HTMLDivElement> & {
    icon?: ReactNode;
    tone?: 'neutral' | 'dashed';
};

const TONE_CLASS_NAMES: Record<NonNullable<DawUtilityNoticeProps['tone']>, string> = {
    neutral: 'border border-border/40 bg-surface-raised/80',
    dashed: 'border border-dashed border-border/50 bg-transparent',
};

export const DawUtilityNotice = ({
    icon,
    tone = 'neutral',
    className,
    children,
    ...props
}: DawUtilityNoticeProps): ReactElement => (
    <div
        className={cn(
            'flex items-start gap-2 rounded-md p-3 text-[10px] leading-relaxed text-muted-foreground',
            TONE_CLASS_NAMES[tone],
            className
        )}
        {...props}
    >
        {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
        <div className="min-w-0 flex-1">{children}</div>
    </div>
);
