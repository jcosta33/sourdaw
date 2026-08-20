import { type HTMLAttributes, type ReactElement } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawChannelStripShellProps = HTMLAttributes<HTMLDivElement> & {
    accentColor?: string;
    selected?: boolean;
};

export const DawChannelStripShell = ({
    accentColor,
    selected = false,
    className,
    children,
    ...props
}: DawChannelStripShellProps): ReactElement => (
    <Stack
        align="center"
        gap={1.5}
        shrink={false}
        className={cn(
            'rounded-lg border border-border-soft border-t-[var(--color-light-edge)] bg-[linear-gradient(180deg,#0c0c0c_0%,#0a0a0a_100%)] p-2 shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.03)]',
            selected ? 'border-transparent ring-1 ring-ring' : '',
            className
        )}
        role="group"
        {...props}
    >
        {accentColor !== undefined ? (
            <div className="mb-1 -mt-2 h-1.5 w-full rounded-t-sm" style={{ backgroundColor: accentColor }} />
        ) : null}
        {children}
    </Stack>
);
