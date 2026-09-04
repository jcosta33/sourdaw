import { type ReactElement, useRef } from 'react';

import { DragResizeHandle } from '#/components/ui/DragResizeHandle';

import { setTrackHeight } from '../../../useCases/toggleTrackState/setTrackHeight';

type ResizeHandleProps = {
    trackId: string;
};

export const ResizeHandle = ({ trackId }: ResizeHandleProps): ReactElement => {
    const startHeightRef = useRef(64);

    return (
        <DragResizeHandle
            side="bottom"
            cursor="ns-resize"
            onMouseDown={(event) => {
                const row = (event.currentTarget as HTMLElement).parentElement;
                startHeightRef.current = row?.getBoundingClientRect().height ?? 64;
            }}
            onPointerDown={(event) => {
                const row = (event.currentTarget as HTMLElement).parentElement;
                startHeightRef.current = row?.getBoundingClientRect().height ?? 64;
            }}
            onResize={(delta) => {
                startHeightRef.current += delta;
                setTrackHeight(trackId, Math.round(startHeightRef.current));
            }}
            className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize opacity-0 hover:opacity-100 hover:bg-ring/40 transition-opacity"
            aria-label="Resize track height"
        />
    );
};
