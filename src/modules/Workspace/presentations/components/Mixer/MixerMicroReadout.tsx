import { type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { cn } from '#/helpers/Styles/cn';

type MixerMicroReadoutProps = HTMLAttributes<HTMLDivElement> & {
    label: ReactNode;
    value?: ReactNode;
    endSlot?: ReactNode;
    labelClassName?: string;
    valueClassName?: string;
};

export const MixerMicroReadout = ({
    label,
    value,
    endSlot,
    className,
    labelClassName,
    valueClassName,
    ...props
}: MixerMicroReadoutProps): ReactElement => (
    <div className={cn('flex items-center justify-between px-0.5', className)} {...props}>
        <span className={cn('text-[6px] uppercase text-muted-foreground/50', labelClassName)}>{label}</span>
        {endSlot ? (
            endSlot
        ) : (
            <span className={cn('max-w-16 truncate text-right text-[10px] text-muted-foreground', valueClassName)}>
                {value}
            </span>
        )}
    </div>
);
