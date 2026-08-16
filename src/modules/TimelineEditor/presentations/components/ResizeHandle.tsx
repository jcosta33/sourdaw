import { type ReactElement, type MouseEvent, useEffect, useRef } from 'react';

import { cn } from '#/utils/Styles/cn';

type ResizeHandleProps = {
    direction: 'horizontal' | 'vertical';
    onResize: (delta: number) => void;
    onResizeEnd?: () => void;
};

export const ResizeHandle = ({ direction, onResize, onResizeEnd }: ResizeHandleProps): ReactElement => {
    const dragging = useRef(false);
    const lastPos = useRef(0);

    useEffect(() => {
        const handleMouseMove = (event: globalThis.MouseEvent) => {
            if (!dragging.current) {
                return;
            }
            const current = direction === 'vertical' ? event.clientX : event.clientY;
            const delta = current - lastPos.current;
            lastPos.current = current;
            onResize(delta);
        };

        const handleMouseUp = () => {
            if (!dragging.current) {
                return;
            }
            dragging.current = false;
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            onResizeEnd?.();
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
            // Unmounting mid-drag (e.g. the panel it resizes is torn down) skips
            // `handleMouseUp`, which otherwise owns clearing these — without this,
            // the cursor and selection lock strand on `document.body` forever.
            if (dragging.current) {
                dragging.current = false;
                document.body.style.cursor = '';
                document.body.style.userSelect = '';
            }
        };
    }, [direction, onResize, onResizeEnd]);

    const handleMouseDown = (event: MouseEvent) => {
        event.preventDefault();
        dragging.current = true;
        lastPos.current = direction === 'vertical' ? event.clientX : event.clientY;
        document.body.style.cursor = direction === 'vertical' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const isVertical = direction === 'vertical';

    return (
        <div
            className={cn('group relative shrink-0', isVertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize')}
            onMouseDown={handleMouseDown}
            role="separator"
            aria-orientation={isVertical ? 'vertical' : 'horizontal'}
        >
            <div
                className={cn(
                    'absolute bg-border/40 transition-colors group-hover:bg-ring/60',
                    isVertical ? 'inset-y-0 left-1/2 w-px -translate-x-1/2' : 'inset-x-0 top-1/2 h-px -translate-y-1/2'
                )}
            />
        </div>
    );
};
