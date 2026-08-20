import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawHeaderBandProps = Omit<HTMLAttributes<HTMLDivElement>, 'title'> & {
    title?: ReactNode;
    actions?: ReactNode;
    startSlot?: ReactNode;
    titleClassName?: string;
    compact?: boolean;
};

export const DawHeaderBand = ({
    title,
    actions,
    startSlot,
    titleClassName,
    compact = false,
    className,
    children,
    ...props
}: DawHeaderBandProps): ReactElement => {
    const paddingClassName = compact ? 'px-2 py-1' : 'px-3 py-1.5';

    if (title === undefined && actions === undefined && startSlot === undefined) {
        return (
            <div className={cn('daw-header-band min-w-0 shrink-0', paddingClassName, className)} {...props}>
                {children}
            </div>
        );
    }

    return (
        <Row
            justify="between"
            gap={2}
            shrink={false}
            className={cn('daw-header-band min-w-0', paddingClassName, className)}
            {...props}
        >
            <Row gap={2} className="min-w-0">
                {startSlot}
                {title !== undefined ? (
                    <span
                        className={cn(
                            'text-[10px] font-medium uppercase tracking-wider text-muted-foreground',
                            titleClassName
                        )}
                    >
                        {title}
                    </span>
                ) : null}
                {children}
            </Row>
            {actions}
        </Row>
    );
};
