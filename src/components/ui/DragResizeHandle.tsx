import { type MouseEvent, type ReactElement, useRef } from 'react';
import { cn } from '#/helpers/Styles/cn';

type DragResizeHandleProps = {
    /** Which side of the panel this handle sits on.
     *  horizontal: 'left' | 'right' — vertical bar between horizontal panels
     *  vertical:   'top' | 'bottom' — horizontal bar between vertical panels
     */
    side: 'left' | 'right' | 'top' | 'bottom';
    /** Callback with the delta in pixels (positive = growing) */
    onResize: (delta: number) => void;
    className?: string;
};

const isVertical = (side: DragResizeHandleProps['side']): boolean => side === 'left' || side === 'right';

/**
 * A thin bar that can be dragged to resize a neighboring panel.
 * Renders a skeuomorphic groove separator.
 */
export const DragResizeHandle = ({ side, onResize, className }: DragResizeHandleProps): ReactElement => {
    const startRef = useRef(0);
    const vertical = isVertical(side);
    // Always call the latest onResize — avoids stale closure jitter mid-drag
    const onResizeRef = useRef(onResize);
    onResizeRef.current = onResize;

    const handleMouseDown = (event: MouseEvent<HTMLDivElement>) => {
        event.preventDefault();
        startRef.current = vertical ? event.clientX : event.clientY;

        const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
            const current = vertical ? moveEvent.clientX : moveEvent.clientY;
            const diff = current - startRef.current;
            startRef.current = current;
            const delta = side === 'left' || side === 'top' ? -diff : diff;
            onResizeRef.current(delta);
        };

        const onMouseUp = () => {
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.body.style.cursor = vertical ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    };

    return (
        <div
            className={cn(
                'shrink-0 select-none transition-colors',
                'bg-surface-tray hover:bg-surface-raised active:bg-surface-overlay',
                vertical
                    ? [
                          'w-[5px] cursor-col-resize border-x border-border-hairline',
                          // groove center line
                          'relative after:absolute after:inset-y-2 after:left-1/2 after:-translate-x-1/2 after:w-px after:bg-[linear-gradient(180deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02),rgba(0,0,0,0.2))]',
                      ]
                    : [
                          'h-[5px] cursor-row-resize border-y border-border-hairline',
                          // groove center line
                          'relative after:absolute after:inset-x-4 after:top-1/2 after:-translate-y-1/2 after:h-px after:bg-[linear-gradient(90deg,rgba(255,255,255,0.08),rgba(255,255,255,0.02),rgba(0,0,0,0.2))]',
                      ],
                className
            )}
            role="separator"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            onMouseDown={handleMouseDown}
        />
    );
};
