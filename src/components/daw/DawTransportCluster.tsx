import { type HTMLAttributes, type ReactElement } from 'react';

import { Row } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawTransportClusterProps = HTMLAttributes<HTMLDivElement> & {
    tone?: 'well' | 'strip';
};

const TONE_CLASS_NAMES: Record<NonNullable<DawTransportClusterProps['tone']>, string> = {
    well: 'daw-readout-well rounded-sm px-1.5 py-1',
    strip: 'daw-control-strip rounded-sm px-1 py-0.5',
};

export const DawTransportCluster = ({
    tone = 'strip',
    className,
    children,
    ...props
}: DawTransportClusterProps): ReactElement => (
    <Row shrink={false} gap={tone === 'well' ? 1 : 0.5} className={cn(TONE_CLASS_NAMES[tone], className)} {...props}>
        {children}
    </Row>
);
