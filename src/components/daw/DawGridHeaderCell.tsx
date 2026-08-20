import { type CSSProperties, type HTMLAttributes, type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawGridHeaderCellProps = HTMLAttributes<HTMLDivElement> & {
    accentColor?: string;
};

export const DawGridHeaderCell = ({
    accentColor,
    className,
    style,
    children,
    ...props
}: DawGridHeaderCellProps): ReactElement => {
    const mergedStyle: CSSProperties = accentColor
        ? {
              ...style,
              borderTopWidth: 2,
              borderTopStyle: 'solid',
              borderTopColor: accentColor,
          }
        : (style ?? {});

    return (
        <Row
            align="center"
            justify="center"
            className={cn(
                'daw-grid-header-cell border-b border-border-hairline px-2 text-[10px] font-medium text-foreground',
                className
            )}
            style={mergedStyle}
            {...props}
        >
            {children}
        </Row>
    );
};
