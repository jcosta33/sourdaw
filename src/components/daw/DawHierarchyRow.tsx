import { type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawHierarchyRowProps = HTMLAttributes<HTMLElement> & {
    as?: 'button' | 'div';
    title: ReactNode;
    startSlot?: ReactNode;
    endSlot?: ReactNode;
    depth?: number;
    indentStep?: number;
    active?: boolean;
    titleClassName?: string;
};

export const DawHierarchyRow = ({
    as = 'button',
    title,
    startSlot,
    endSlot,
    depth = 0,
    indentStep = 12,
    active = false,
    className,
    titleClassName,
    style,
    ...props
}: DawHierarchyRowProps): ReactElement => {
    const classNames = cn(
        'w-full rounded text-left transition-colors',
        active
            ? 'bg-white/[0.08] text-foreground'
            : 'text-muted-foreground hover:bg-white/[0.04] hover:text-foreground',
        className
    );
    const mergedStyle: CSSProperties = { paddingLeft: `${depth * indentStep + 4}px`, ...style };
    const content = (
        <>
            {startSlot}
            <span className={cn('min-w-0 flex-1 truncate text-[10px]', titleClassName)}>{title}</span>
            {endSlot}
        </>
    );

    if (as === 'div') {
        return (
            <Row gap={1} className={classNames} style={mergedStyle} {...props}>
                {content}
            </Row>
        );
    }

    return (
        <Row as="button" type="button" gap={1} className={classNames} style={mergedStyle} {...props}>
            {content}
        </Row>
    );
};
