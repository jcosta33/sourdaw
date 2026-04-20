import { type HTMLAttributes, type ReactElement } from 'react';

import { Row } from '#/components/layout';

type DawPluginMetricStripProps = HTMLAttributes<HTMLDivElement> & {
    align?: 'start' | 'end';
};

export const DawPluginMetricStrip = ({
    align = 'end',
    className,
    children,
    ...props
}: DawPluginMetricStripProps): ReactElement => (
    <Row
        wrap
        gap={2}
        justify={align === 'end' ? 'end' : 'start'}
        className={className}
        {...props}
    >
        {children}
    </Row>
);
