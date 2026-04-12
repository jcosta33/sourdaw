import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { DawMiniSectionHeader } from '#/components/daw/DawMiniSectionHeader';
import { cn } from '#/utils/Styles/cn';

type MixerSectionProps = HTMLAttributes<HTMLElement> & {
    label: ReactNode;
    bodyClassName?: string;
};

export const MixerSection = ({
    label,
    className,
    bodyClassName,
    children,
    ...props
}: MixerSectionProps): ReactElement => (
    <section className={cn('w-full space-y-0.5', className)} {...props}>
        <DawMiniSectionHeader label={label} />
        <div className={cn('space-y-0.5', bodyClassName)}>{children}</div>
    </section>
);
