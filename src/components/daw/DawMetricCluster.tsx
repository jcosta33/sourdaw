import { type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';

import { Row } from '#/components/layout';

import { DawEyebrowLabel } from './DawEyebrowLabel';

type DawMetricClusterProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    meter?: ReactNode;
    value?: ReactNode;
    ref?: Ref<HTMLDivElement>;
};

export const DawMetricCluster = ({
    label,
    meter,
    value,
    className,
    children,
    ...props
}: DawMetricClusterProps): ReactElement => (
    <Row gap={1} className={className} {...props}>
        <DawEyebrowLabel size="sm" className="text-muted-foreground">
            {label}
        </DawEyebrowLabel>
        {meter}
        {value}
        {children}
    </Row>
);
