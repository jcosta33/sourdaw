import { type ComponentProps, type ReactElement } from 'react';
import { cn } from '#/helpers/Styles/cn';

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
            'w-full rounded border border-border-soft bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none focus:ring-1 focus:ring-border-focus',
            monospace ? 'font-mono' : '',
            className
        )}
        {...props}
    />
);
