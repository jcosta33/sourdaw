import { type ComponentProps, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { Input } from '#/components/ui/input';

type DawCompactInputProps = Omit<ComponentProps<typeof Input>, 'size'> & {
    size?: 'micro' | 'sm';
    align?: 'left' | 'center' | 'right';
    monospace?: boolean;
};

const SIZE_CLASS_NAMES: Record<NonNullable<DawCompactInputProps['size']>, string> = {
    micro: 'h-6 px-2 text-xs',
    sm: 'h-7 px-2 text-xs',
};

const ALIGN_CLASS_NAMES: Record<NonNullable<DawCompactInputProps['align']>, string> = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
};

export const DawCompactInput = ({
    size = 'sm',
    align = 'left',
    monospace = false,
    className,
    ...props
}: DawCompactInputProps): ReactElement => (
    <Input
        className={cn(
            SIZE_CLASS_NAMES[size],
            ALIGN_CLASS_NAMES[align],
            monospace ? 'font-mono' : '',
            className
        )}
        {...props}
    />
);
