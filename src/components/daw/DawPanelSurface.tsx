import { type CSSProperties, type HTMLAttributes, type ReactElement, type ReactNode } from 'react';

import { cn } from '#/utils/Styles/cn';

type DawPanelSurfaceProps = HTMLAttributes<HTMLDivElement> & {
    as?: 'div' | 'aside';
    tone?: 'base' | 'dock' | 'tray';
    style?: CSSProperties;
    children: ReactNode;
};

const TONE_CLASS_NAMES: Record<NonNullable<DawPanelSurfaceProps['tone']>, string> = {
    base: 'flex h-full flex-col bg-surface-base',
    dock: 'flex shrink-0 flex-col border-t border-black/60 bg-surface-base shadow-[inset_0_1px_4px_rgba(0,0,0,0.5)]',
    tray: 'contain-strict flex shrink-0 flex-col border-l border-border-hairline bg-surface-tray shadow-[inset_1px_0_0_rgba(255,255,255,0.02),inset_0_1px_0_rgba(255,255,255,0.04)]',
};

export const DawPanelSurface = ({
    as = 'div',
    tone = 'base',
    className,
    children,
    ...props
}: DawPanelSurfaceProps): ReactElement => {
    const Component = as;
    return (
        <Component className={cn(TONE_CLASS_NAMES[tone], className)} {...props}>
            {children}
        </Component>
    );
};
