import { type ButtonHTMLAttributes, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawSwatchButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'color'> & {
    color: string;
    active?: boolean;
    size?: 'sm' | 'md';
};

export const DawSwatchButton = ({
    color,
    active = false,
    size = 'sm',
    className,
    type = 'button',
    ...props
}: DawSwatchButtonProps): ReactElement => (
    <button
        type={type}
        aria-pressed={active}
        className={cn(
            'rounded-full border border-white/14 transition-all hover:ring-1 hover:ring-foreground/30',
            size === 'sm' ? 'size-3.5' : 'size-4.5',
            active ? 'ring-2 ring-white/85 ring-offset-1 ring-offset-black/20' : '',
            className
        )}
        style={{ backgroundColor: color }}
        {...props}
    />
);
