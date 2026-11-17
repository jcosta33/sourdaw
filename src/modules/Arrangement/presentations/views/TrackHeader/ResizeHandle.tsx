import { type ReactElement, useEffect, useRef } from 'react';

import { DragResizeHandle } from '#/components/ui/DragResizeHandle';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { setTimelineTrackHeightPreview } from '../../../stores/timelineViewStore';
import { clampTrackHeight, MAX_TRACK_HEIGHT, MIN_TRACK_HEIGHT } from '../../../useCases/clampTrackHeight';

type ResizeHandleProps = {
    trackId: string;
    trackName: string;
    height: number;
    displayHeight: number;
    heightScale: number;
};

export const ResizeHandle = ({
    trackId,
    trackName,
    height,
    displayHeight,
    heightScale,
}: ResizeHandleProps): ReactElement => {
    const pendingHeight = useRef<number | null>(null);
    const cancelListener = useRef<AbortController | null>(null);

    useEffect(
        () => () => {
            cancelListener.current?.abort();
            setTimelineTrackHeightPreview(trackId, null);
        },
        [trackId]
    );

    return (
        <DragResizeHandle
            side="bottom"
            cursor="ns-resize"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => {
                event.stopPropagation();
                if (event.button !== 0 || cancelListener.current) {
                    return;
                }
                const pointerId = event.pointerId;
                const controller = new AbortController();
                cancelListener.current = controller;
                document.addEventListener(
                    'pointercancel',
                    (cancellation) => {
                        if (cancellation.pointerId === pointerId) {
                            pendingHeight.current = null;
                            setTimelineTrackHeightPreview(trackId, null);
                        }
                    },
                    // Clear the draft before DragResizeHandle's end callback runs.
                    { capture: true, signal: controller.signal }
                );
            }}
            onResize={(delta) => {
                const next = clampTrackHeight(pendingHeight.current ?? height, delta / heightScale);
                pendingHeight.current = next;
                setTimelineTrackHeightPreview(trackId, next);
            }}
            onSetSize={(size) => {
                pendingHeight.current = clampTrackHeight(size / heightScale, 0);
            }}
            onResizeEnd={() => {
                cancelListener.current?.abort();
                cancelListener.current = null;
                const next = pendingHeight.current;
                pendingHeight.current = null;
                if (next !== null && Math.abs(next - height) > Number.EPSILON * MAX_TRACK_HEIGHT) {
                    void executeUserAppAction({ type: 'setTrackHeight', payload: { trackId, height: next } });
                }
                setTimelineTrackHeightPreview(trackId, null);
            }}
            className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize opacity-0 hover:opacity-100 hover:bg-ring/40 focus-visible:opacity-100 focus-visible:bg-ring/40 transition-opacity"
            aria-label={`Resize ${trackName} height`}
            aria-valuenow={displayHeight}
            aria-valuemin={MIN_TRACK_HEIGHT * heightScale}
            aria-valuemax={MAX_TRACK_HEIGHT * heightScale}
        />
    );
};
