import { type ComponentPropsWithRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';

import { createPortal } from 'react-dom';

import { cn } from '#/utils/Styles/cn';

type DawContextMenuSurfaceProps = ComponentPropsWithRef<'div'> & {
    x: number;
    y: number;
    children?: ReactNode;
    xClampOffset?: number;
    yClampOffset?: number;
    anchorY?: 'down' | 'up' | 'auto';
    backdrop?: boolean;
    portal?: boolean;
    onClose?: () => void;
    style?: CSSProperties;
};

export const DawContextMenuSurface = ({
    x,
    y,
    children,
    xClampOffset = 200,
    yClampOffset = 400,
    anchorY = 'down',
    backdrop = false,
    portal = true,
    onClose,
    className,
    style,
    ...props
}: DawContextMenuSurfaceProps): ReactElement => {
    const farEdgeInset = 8;
    const availableAbove = Math.max(0, y - farEdgeInset);
    const availableBelow = Math.max(0, window.innerHeight - y - farEdgeInset);
    const useBottomAnchor = anchorY === 'up' || (availableBelow < yClampOffset && availableAbove > availableBelow);
    const verticalPosition = useBottomAnchor
        ? Math.max(farEdgeInset, window.innerHeight - y)
        : Math.max(farEdgeInset, y);
    const positionStyle: CSSProperties = {
        left: Math.min(x, window.innerWidth - xClampOffset),
        maxHeight: `calc(100vh - ${String(verticalPosition + farEdgeInset)}px)`,
        overflowY: 'auto',
        ...(useBottomAnchor ? { bottom: verticalPosition } : { top: verticalPosition }),
    };

    const surface = (
        <>
            {backdrop && onClose ? (
                <button
                    aria-label="Close context menu"
                    className="fixed inset-0 z-40 cursor-default appearance-none border-0 bg-transparent p-0"
                    onClick={onClose}
                    type="button"
                />
            ) : null}
            <div
                className={cn('daw-floating-surface fixed z-50 rounded-md py-1', className)}
                style={{ ...positionStyle, ...style }}
                {...props}
            >
                {children}
            </div>
        </>
    );

    if (!portal) {
        return <>{surface}</>;
    }

    return createPortal(surface, document.body);
};
