import { type HTMLAttributes, type ReactElement, type ReactNode, type Ref } from 'react';

import { cn } from '#/utils/Styles/cn';
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
    <div className={cn('flex items-center gap-1', className)} {...props}>
        <DawEyebrowLabel size="sm" className="text-muted-foreground">
            {label}
        </DawEyebrowLabel>
        {meter}
        {value}
        {children}
    </div>
);
