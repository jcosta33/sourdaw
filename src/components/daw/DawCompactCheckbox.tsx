import { type ComponentProps, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawCompactCheckboxProps = ComponentProps<'input'>;

export const DawCompactCheckbox = ({
    className,
    type = 'checkbox',
    ...props
}: DawCompactCheckboxProps): ReactElement => (
    <input
        type={type}
        className={cn(
            'size-3 rounded border border-border-soft bg-surface-inset accent-[var(--color-accent-orange)] shadow-[inset_0_1px_2px_rgba(0,0,0,0.35)]',
            className
        )}
        {...props}
    />
);
