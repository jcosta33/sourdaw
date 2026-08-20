import { type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawUtilityListRowProps = {
    title: ReactNode;
    subtitle?: ReactNode;
    startSlot?: ReactNode;
    endSlot?: ReactNode;
    onPress?: () => void;
    active?: boolean;
    dimmed?: boolean;
    titleClassName?: string;
    subtitleClassName?: string;
    className?: string;
};

export const DawUtilityListRow = ({
    title,
    subtitle,
    startSlot,
    endSlot,
    onPress,
    active = false,
    dimmed = false,
    className,
    titleClassName,
    subtitleClassName,
}: DawUtilityListRowProps): ReactElement => {
    const content = (
        <>
            {startSlot ? <div className="shrink-0">{startSlot}</div> : null}
            <div className="min-w-0 flex-1">
                <div
                    className={cn(
                        'truncate text-[11px] text-foreground/85',
                        active ? 'font-medium text-foreground' : '',
                        titleClassName
                    )}
                >
                    {title}
                </div>
                {subtitle ? (
                    <div className={cn('text-[9px] text-muted-foreground', subtitleClassName)}>{subtitle}</div>
                ) : null}
            </div>
            {endSlot ? <div className="shrink-0">{endSlot}</div> : null}
        </>
    );

    const sharedClassName = cn(
        'w-full px-3 py-1.5 text-left transition-colors',
        onPress ? 'hover:bg-accent/50' : '',
        active ? 'bg-accent/35' : '',
        dimmed ? 'opacity-40' : '',
        className
    );

    if (onPress) {
        return (
            <Row as="button" type="button" gap={2} className={sharedClassName} onClick={onPress}>
                {content}
            </Row>
        );
    }

    return (
        <Row gap={2} className={sharedClassName}>
            {content}
        </Row>
    );
};
