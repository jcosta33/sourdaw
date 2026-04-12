import { type HTMLAttributes, type ReactElement } from 'react';
import { cn } from '#/utils/Styles/cn';

type DawInlineHintProps = HTMLAttributes<HTMLDivElement>;

export const DawInlineHint = ({ className, children, ...props }: DawInlineHintProps): ReactElement => (
    <div
        className={cn(
            'inline-flex items-center justify-center rounded-sm px-2 py-1 text-center text-[9px] text-muted-foreground/35',
            className
        )}
        {...props}
    >
        {children}
    </div>
);
