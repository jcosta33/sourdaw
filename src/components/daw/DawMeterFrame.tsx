import { type HTMLAttributes, type ReactElement, type Ref } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawMeterFrameProps = HTMLAttributes<HTMLDivElement> & {
    overlay?: 'horizontal' | 'vertical' | 'radial';
    ref?: Ref<HTMLDivElement>;
};

const OVERLAY_STYLES: Record<NonNullable<DawMeterFrameProps['overlay']>, string> = {
    horizontal: 'linear-gradient(90deg, rgba(10,10,10,1) 0%, transparent 3%, transparent 97%, rgba(10,10,10,1) 100%)',
    vertical: 'linear-gradient(180deg, rgba(10,10,10,1) 0%, transparent 3%, transparent 97%, rgba(10,10,10,1) 100%)',
    radial: 'radial-gradient(ellipse at center, transparent 60%, rgba(10,10,10,0.8) 100%)',
};

export const DawMeterFrame = ({
    overlay = 'horizontal',
    className,
    children,
    ...props
}: DawMeterFrameProps): ReactElement => (
    <div className={cn('relative overflow-hidden rounded bg-surface-base channel-inset', className)} {...props}>
        {children}
        <div className="pointer-events-none absolute inset-0 rounded" style={{ background: OVERLAY_STYLES[overlay] }} />
    </div>
);
