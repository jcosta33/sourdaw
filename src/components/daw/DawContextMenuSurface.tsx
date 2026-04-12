import { createPortal } from 'react-dom';
import { type ComponentPropsWithRef, type CSSProperties, type ReactElement, type ReactNode } from 'react';
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
    const useBottomAnchor = anchorY === 'up' || (anchorY === 'auto' && y > window.innerHeight - yClampOffset);
    const positionStyle: CSSProperties = useBottomAnchor
        ? {
              left: Math.min(x, window.innerWidth - xClampOffset),
              bottom: Math.max(8, window.innerHeight - y),
          }
        : {
              left: Math.min(x, window.innerWidth - xClampOffset),
              top: Math.min(y, window.innerHeight - yClampOffset),
          };

    const surface = (
        <>
            {backdrop && onClose ? <div className="fixed inset-0 z-40" onClick={onClose} /> : null}
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
