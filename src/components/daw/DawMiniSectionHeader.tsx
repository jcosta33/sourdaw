import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DawMiniSectionHeaderProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    showSeam?: boolean;
};

export const DawMiniSectionHeader = ({
    label,
    showSeam = true,
    className,
    ...props
}: DawMiniSectionHeaderProps): ReactElement => (
    <div className={cn('w-full space-y-0.5', className)} {...props}>
        {showSeam ? <div className="daw-seam my-1 h-px" /> : null}
        <div className="block text-center text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
            {label}
        </div>
    </div>
);
