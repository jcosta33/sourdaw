import { type ReactElement, useCallback, useRef } from 'react';
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

const isVertical = (side: DragResizeHandleProps['side']): boolean =>
    side === 'left' || side === 'right';

/**
 * A thin bar that can be dragged to resize a neighboring panel.
 * Renders a skeuomorphic groove separator.
 */
export const DragResizeHandle = ({ side, onResize, className }: DragResizeHandleProps): ReactElement => {
    const startRef = useRef(0);
    const vertical = isVertical(side);

    const handleMouseDown = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            startRef.current = vertical ? e.clientX : e.clientY;

            const onMouseMove = (me: MouseEvent) => {
                const current = vertical ? me.clientX : me.clientY;
                const diff = current - startRef.current;
                startRef.current = current;

                // left/top handle: dragging right/down = shrink → invert
                // right/bottom handle: dragging right/down = grow
                const delta = side === 'left' || side === 'top' ? -diff : diff;
                onResize(delta);
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
        },
        [side, onResize, vertical],
    );

    return (
        <div
            className={cn(
                'shrink-0 select-none transition-colors',
                'bg-[#0a0a0a] hover:bg-[#1a1a1a] active:bg-[#222]',
                vertical
                    ? [
                          'w-[5px] cursor-col-resize border-x border-border-hairline',
                          // groove center line
                          'relative after:absolute after:inset-y-2 after:left-1/2 after:-translate-x-1/2 after:w-px after:bg-white/[0.04]',
                      ]
                    : [
                          'h-[5px] cursor-row-resize border-y border-border-hairline',
                          // groove center line
                          'relative after:absolute after:inset-x-4 after:top-1/2 after:-translate-y-1/2 after:h-px after:bg-white/[0.04]',
                      ],
                className,
            )}
            role="separator"
            aria-orientation={vertical ? 'vertical' : 'horizontal'}
            onMouseDown={handleMouseDown}
        />
    );
};
