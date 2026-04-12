import { type HTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawTransportClusterProps = HTMLAttributes<HTMLDivElement> & {
    tone?: 'well' | 'strip';
};

const TONE_CLASS_NAMES: Record<NonNullable<DawTransportClusterProps['tone']>, string> = {
    well: 'daw-readout-well gap-1 rounded-sm px-1.5 py-1',
    strip: 'daw-control-strip gap-0.5 rounded-sm px-1 py-0.5',
};

export const DawTransportCluster = ({
    tone = 'strip',
    className,
    children,
    ...props
}: DawTransportClusterProps): ReactElement => (
    <div className={cn('flex min-w-0 shrink-0 items-center', TONE_CLASS_NAMES[tone], className)} {...props}>
        {children}
    </div>
);
