import { type ButtonHTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawChooserCardProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> & {
    title: ReactNode;
    description?: ReactNode;
    startSlot?: ReactNode;
    endSlot?: ReactNode;
    badge?: ReactNode;
    active?: boolean;
    dimmed?: boolean;
    compact?: boolean;
};

export const DawChooserCard = ({
    title,
    description,
    startSlot,
    endSlot,
    badge,
    active = false,
    dimmed = false,
    compact = false,
    className,
    children,
    type = 'button',
    ...props
}: DawChooserCardProps): ReactElement => (
    <button
        type={type}
        className={cn(
            'w-full rounded-lg border text-left transition-all',
            compact ? 'px-2 py-2' : 'px-3 py-3',
            active
                ? 'border-white/18 bg-white/[0.045]'
                : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]',
            dimmed ? 'text-foreground/60' : 'text-foreground/90',
            className
        )}
        {...props}
    >
        <Row align="start" gap={2.5}>
            {startSlot ? <div className="shrink-0">{startSlot}</div> : null}

            <div className="min-w-0 flex-1">
                <Row gap={1.5}>
                    <span
                        className={cn(
                            'leading-tight',
                            compact ? 'text-[11px] font-medium' : 'text-[12px] font-semibold'
                        )}
                    >
                        {title}
                    </span>
                    {badge}
                </Row>
                {description ? (
                    <div
                        className={cn(
                            'mt-0.5 leading-tight text-muted-foreground/70',
                            compact ? 'text-[9px]' : 'text-[10px]'
                        )}
                    >
                        {description}
                    </div>
                ) : null}
            </div>

            {endSlot ? <div className="shrink-0">{endSlot}</div> : null}
        </Row>
        {children ? <div className="mt-1.5">{children}</div> : null}
    </button>
);
