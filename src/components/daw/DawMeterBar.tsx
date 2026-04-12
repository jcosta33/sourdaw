import { type HTMLAttributes, type ReactElement, type Ref } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawMeterBarProps = Omit<HTMLAttributes<HTMLDivElement>, 'children'> & {
    fillRef?: Ref<HTMLDivElement>;
    fillClassName?: string;
    trackClassName?: string;
    size?: 'sm' | 'md';
    value?: number;
};

export const DawMeterBar = ({
    fillRef,
    fillClassName,
    trackClassName,
    size = 'md',
    value = 0,
    className,
    ...props
}: DawMeterBarProps): ReactElement => (
    <div
        className={cn(
            'overflow-hidden rounded-full bg-[rgba(255,255,255,0.06)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.5)]',
            size === 'sm' ? 'h-1.5' : 'h-2',
            className,
            trackClassName
        )}
        {...props}
    >
        <div
            ref={fillRef}
            className={cn(
                'h-full rounded-full bg-[var(--color-state-success)] transition-[width] duration-150',
                fillClassName
            )}
            style={{ width: `${String(value)}%` }}
        />
    </div>
);
