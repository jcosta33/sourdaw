import { type ComponentProps, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawEyebrowLabelProps = ComponentProps<'span'> & {
    size?: 'xs' | 'sm';
};

export const DawEyebrowLabel = ({ size = 'xs', className, children, ...props }: DawEyebrowLabelProps): ReactElement => (
    <span
        className={cn(
            'font-medium uppercase tracking-wider text-muted-foreground/60',
            size === 'sm' ? 'text-[10px]' : 'text-[9px]',
            className
        )}
        {...props}
    >
        {children}
    </span>
);
