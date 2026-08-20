import { type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { Stack } from '#/components/layout';
import { cn } from '#/utils/Styles/cn';

type DawPanelSurfaceProps = HTMLAttributes<HTMLDivElement> & {
    as?: 'div' | 'aside';
    tone?: 'base' | 'dock' | 'tray';
    style?: CSSProperties;
    children: ReactNode;
};

const TONE_CLASS_NAMES: Record<NonNullable<DawPanelSurfaceProps['tone']>, string> = {
    base: 'h-full bg-surface-base',
    dock: 'border-t border-black/60 bg-surface-base shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]',
    tray: 'contain-strict border-l border-border-hairline bg-surface-tray shadow-[inset_1px_0_0_rgba(255,255,255,0.02),inset_0_1px_0_rgba(255,255,255,0.04)]',
};

export const DawPanelSurface = ({
    as = 'div',
    tone = 'base',
    className,
    children,
    ...props
}: DawPanelSurfaceProps): ReactElement => (
    <Stack as={as} shrink={tone === 'base'} className={cn(TONE_CLASS_NAMES[tone], className)} {...props}>
        {children}
    </Stack>
);
