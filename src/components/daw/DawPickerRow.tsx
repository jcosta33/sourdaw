import { type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawPickerRowProps = {
    heading: ReactNode;
    description?: ReactNode;
    startSlot?: ReactNode;
    endSlot?: ReactNode;
    active?: boolean;
    compact?: boolean;
    className?: string;
    href?: string;
    target?: string;
    rel?: string;
    onClick?: () => void;
    title?: string;
    role?: string;
    tabIndex?: number;
    onKeyDown?: (event: React.KeyboardEvent<HTMLElement>) => void;
};

export const DawPickerRow = ({
    heading,
    description,
    startSlot,
    endSlot,
    active = false,
    compact = true,
    className,
    href,
    target,
    rel,
    onClick,
    title,
    role,
    tabIndex,
    onKeyDown,
}: DawPickerRowProps): ReactElement => {
    const sharedClassName = cn(
        'group w-full rounded-md border text-left transition-all',
        compact ? 'px-2 py-1.5' : 'px-3 py-2',
        active ? 'border-white/16 bg-white/[0.04]' : 'border-transparent hover:border-white/10 hover:bg-white/[0.03]',
        className
    );

    const content = (
        <>
            {startSlot ? <div className="mt-0.5 shrink-0">{startSlot}</div> : null}
            <div className="min-w-0 flex-1">
                <div
                    className={cn(
                        compact ? 'text-[10px] font-medium' : 'text-[11px] font-medium',
                        'truncate text-foreground/90'
                    )}
                >
                    {heading}
                </div>
                {description ? (
                    <div
                        className={cn(
                            compact ? 'text-[9px]' : 'text-[10px]',
                            'mt-0.5 leading-tight text-muted-foreground/65'
                        )}
                    >
                        {description}
                    </div>
                ) : null}
            </div>
            {endSlot ? <div className="shrink-0">{endSlot}</div> : null}
        </>
    );

    if (href) {
        return (
            <Row
                as="a"
                href={href}
                target={target}
                rel={rel}
                align="start"
                gap={2}
                className={sharedClassName}
                title={title}
                role={role}
                tabIndex={tabIndex}
                onKeyDown={onKeyDown}
            >
                {content}
            </Row>
        );
    }

    if (onClick) {
        return (
            <Row
                as="button"
                type="button"
                align="start"
                gap={2}
                className={sharedClassName}
                onClick={onClick}
                title={title}
                role={role}
                tabIndex={tabIndex}
            >
                {content}
            </Row>
        );
    }

    return (
        <Row
            align="start"
            gap={2}
            className={sharedClassName}
            title={title}
            role={role}
            tabIndex={tabIndex}
            onKeyDown={onKeyDown}
        >
            {content}
        </Row>
    );
};
