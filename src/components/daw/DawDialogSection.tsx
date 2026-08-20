import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

import { DawEyebrowLabel } from './DawEyebrowLabel';

type DawDialogSectionProps = HTMLAttributes<HTMLElement> & {
    title?: ReactNode;
    detail?: ReactNode;
    actions?: ReactNode;
    bodyClassName?: string;
    tone?: 'neutral' | 'warm';
};

const TONE_CLASS_NAMES: Record<NonNullable<DawDialogSectionProps['tone']>, string> = {
    neutral:
        'border-white/8 bg-white/[0.03] shadow-[inset_0_1px_0_rgba(255,255,255,0.03),inset_0_-1px_0_rgba(0,0,0,0.22)]',
    warm: 'border-orange-900/30 bg-stone-950/50 shadow-[inset_0_1px_0_rgba(251,146,60,0.05)]',
};

const HEADER_TONE_CLASS_NAMES: Record<NonNullable<DawDialogSectionProps['tone']>, string> = {
    neutral: 'border-white/6',
    warm: 'border-orange-900/25',
};

const TITLE_TONE_CLASS_NAMES: Record<NonNullable<DawDialogSectionProps['tone']>, string> = {
    neutral: 'text-foreground/85',
    warm: 'text-orange-300/85',
};

export const DawDialogSection = ({
    title,
    detail,
    actions,
    tone = 'neutral',
    className,
    bodyClassName,
    children,
    ...props
}: DawDialogSectionProps): ReactElement => (
    <section className={cn('overflow-hidden rounded-lg border', TONE_CLASS_NAMES[tone], className)} {...props}>
        {title || detail || actions ? (
            <Row justify="between" gap={3} className={cn('border-b px-3 py-2.5', HEADER_TONE_CLASS_NAMES[tone])}>
                <div className="min-w-0">
                    {title ? (
                        <DawEyebrowLabel size="sm" className={TITLE_TONE_CLASS_NAMES[tone]}>
                            {title}
                        </DawEyebrowLabel>
                    ) : null}
                    {detail ? <div className="mt-0.5 text-[10px] text-muted-foreground/75">{detail}</div> : null}
                </div>
                {actions ? <div className="shrink-0">{actions}</div> : null}
            </Row>
        ) : null}
        <div className={cn('px-3 py-3', bodyClassName)}>{children}</div>
    </section>
);
