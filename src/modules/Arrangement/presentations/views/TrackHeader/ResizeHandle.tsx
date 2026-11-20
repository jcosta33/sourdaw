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
    const pendingHeightRef = useRef<number | null>(null);

    useEffect(() => () => setTimelineTrackHeightPreview(trackId, null), [trackId]);

    return (
        <DragResizeHandle
            side="bottom"
            cursor="ns-resize"
            onMouseDown={(event) => event.stopPropagation()}
            onPointerDown={(event) => event.stopPropagation()}
            onResize={(delta) => {
                const next = clampTrackHeight(pendingHeightRef.current ?? height, delta / heightScale);
                pendingHeightRef.current = next;
                setTimelineTrackHeightPreview(trackId, next);
            }}
            onSetSize={(size) => {
                pendingHeightRef.current = clampTrackHeight(size / heightScale, 0);
            }}
            onResizeEnd={() => {
                const next = pendingHeightRef.current;
                pendingHeightRef.current = null;
                if (next !== null && Math.abs(next - height) > Number.EPSILON * MAX_TRACK_HEIGHT) {
                    void executeUserAppAction({ type: 'setTrackHeight', payload: { trackId, height: next } });
                }
                setTimelineTrackHeightPreview(trackId, null);
            }}
            onResizeCancel={() => {
                pendingHeightRef.current = null;
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
