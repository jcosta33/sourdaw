import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type MetaTextProps = HTMLAttributes<HTMLSpanElement>;

export const MetaText = ({ className, children, ...props }: MetaTextProps): ReactElement => (
    <span className={cn('text-[10px] text-muted-foreground', className)} {...props}>
        {children}
    </span>
);
