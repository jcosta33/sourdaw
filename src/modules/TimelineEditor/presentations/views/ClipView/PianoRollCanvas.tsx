import { type ComponentPropsWithoutRef, type ReactElement, type RefObject } from 'react';

import { PITCH_RAIL_WIDTH } from '../../helpers/pianoRollConstants';

type PianoRollCanvasProps = Pick<
    ComponentPropsWithoutRef<'canvas'>,
    | 'onMouseDown'
    | 'onMouseMove'
    | 'onMouseUp'
    | 'onMouseLeave'
    | 'onPointerCancel'
    | 'onBlur'
    | 'onDoubleClick'
    | 'onKeyDown'
    | 'onContextMenu'
> & {
    canvasRef: RefObject<HTMLCanvasElement | null>;
    contentWidth: number;
    contentHeight: number;
    cursor: string;
};

export function PianoRollCanvas({
    canvasRef,
    contentWidth,
    contentHeight,
    cursor,
    ...events
}: PianoRollCanvasProps): ReactElement {
    return (
        // The wrapper keeps all beats reachable, even when the backing store
        // only fits the visible canvas slice.
        <div className="flex-1" style={{ minWidth: contentWidth }}>
            {/*
             * The canvas sticks to the right edge of the pitch rail while the
             * wrapper scrolls past it. The offset and renderer share one rail
             * width so the drawn slice lines up with the visible slice.
             */}
            <canvas
                ref={canvasRef}
                className="sticky outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
                style={{ left: PITCH_RAIL_WIDTH, cursor, height: contentHeight }}
                tabIndex={0}
                // Global shortcut routing admits editor-safe keys on this
                // surface and skips keys the canvas claims with preventDefault.
                data-canvas-editor=""
                aria-label="Piano roll editor"
                {...events}
            />
        </div>
    );
}
