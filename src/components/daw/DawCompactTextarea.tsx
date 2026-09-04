import { type ComponentProps, type ReactElement } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawCompactTextareaProps = ComponentProps<'textarea'> & {
    monospace?: boolean;
};

export const DawCompactTextarea = ({
    monospace = false,
    className,
    ...props
}: DawCompactTextareaProps): ReactElement => (
    <textarea
        className={cn(
            'w-full rounded border border-border-soft bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 resize-none outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70 focus-visible:border-border-focus/70',
            monospace ? 'font-mono' : '',
            className
        )}
        {...props}
    />
);
