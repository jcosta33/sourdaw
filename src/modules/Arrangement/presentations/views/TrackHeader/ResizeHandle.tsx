import { type ReactElement, useRef } from 'react';

import { DragResizeHandle } from '#/components/ui/DragResizeHandle';

import { setTrackHeight } from '../../../useCases/toggleTrackState/setTrackHeight';

type ResizeHandleProps = {
    trackId: string;
};

export const ResizeHandle = ({ trackId }: ResizeHandleProps): ReactElement => {
    const handleRef = useRef<HTMLDivElement | null>(null);
    const heightRef = useRef<number | null>(null);

    const getParentHeight = (): number => {
        const height = handleRef.current?.parentElement?.getBoundingClientRect().height;
        return height && height > 0 ? height : 64;
    };

    return (
        <DragResizeHandle
            ref={handleRef}
            side="bottom"
            cursor="ns-resize"
            onMouseDown={(event) => {
                event.stopPropagation();
                heightRef.current = getParentHeight();
            }}
            onPointerDown={(event) => {
                event.stopPropagation();
                heightRef.current = getParentHeight();
            }}
            onResize={(delta) => {
                const base = heightRef.current ?? getParentHeight();
                const next = Math.max(30, Math.min(300, Math.round(base + delta)));
                heightRef.current = next;
                setTrackHeight(trackId, next);
            }}
            onResizeEnd={() => {
                heightRef.current = null;
            }}
            className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize opacity-0 hover:opacity-100 hover:bg-ring/40 focus-visible:opacity-100 focus-visible:bg-ring/40 transition-opacity"
            aria-label="Resize track height"
        />
    );
};
