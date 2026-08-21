import { type ComponentProps, type ReactElement } from 'react';

import { Button } from '#/components/ui/button';
import { cn } from '#/utils/Styles/cn';

type CaptureKeyButtonProps = ComponentProps<'button'> & {
    listening?: boolean;
};

export const CaptureKeyButton = ({
    listening = false,
    className,
    children,
    ...props
}: CaptureKeyButtonProps): ReactElement => (
    <Button
        variant="bare"
        size="bare"
        type="button"
        className={cn(
            'rounded border bg-surface-overlay font-mono text-foreground transition-colors',
            listening ? 'border-primary bg-primary/10 text-primary animate-pulse' : 'border-border',
            className
        )}
        {...props}
    >
        {children}
    </Button>
);
