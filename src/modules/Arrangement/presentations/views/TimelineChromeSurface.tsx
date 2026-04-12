import { type ComponentPropsWithRef, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/utils/Styles/cn';

type TimelineChromeSurfaceProps = ComponentPropsWithRef<'div'> & {
    tone?: 'band' | 'subtle';
    children?: ReactNode;
};

const TONE_CLASS_NAMES: Record<NonNullable<TimelineChromeSurfaceProps['tone']>, string> = {
    band: 'daw-header-band',
    subtle: 'border-b border-border/30 bg-surface-base shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_1px_0_rgba(0,0,0,0.2)]',
};

export const TimelineChromeSurface = ({
    tone = 'band',
    className,
    children,
    ...props
}: TimelineChromeSurfaceProps): ReactElement => (
    <div className={cn('relative w-full shrink-0 overflow-hidden', TONE_CLASS_NAMES[tone], className)} {...props}>
        {children}
    </div>
);
