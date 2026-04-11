import { type RefObject, useEffect } from 'react';
import {
    zoomTimeline,
    scrollTimeline,
    setAutoScroll,
    setScrollY,
    timelineViewStore,
} from '../../stores/timelineViewStore';
import { trackStore } from '../../stores/trackStore';
import { transportStore } from '#/modules/Transport/stores';

interface GestureEvent extends UIEvent {
    readonly scale: number;
}

export const useTimelineGestures = (canvasRef: RefObject<HTMLCanvasElement | null>): void => {
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }

        let lastScale = 1;

        const onGestureStart = (e: Event): void => {
            e.preventDefault();
            lastScale = 1;
        };

        const onGestureChange = (e: Event): void => {
            e.preventDefault();
            const ge = e as GestureEvent;
            const delta = ge.scale - lastScale;
            lastScale = ge.scale;
            zoomTimeline(delta * 2);
        };

        const onGestureEnd = (e: Event): void => {
            e.preventDefault();
        };

        const onWheel = (e: WheelEvent): void => {
            e.preventDefault();
            if (e.ctrlKey || e.metaKey) {
                const isPinch = Math.abs(e.deltaY) < 10;
                const zoomFactor = isPinch ? -e.deltaY * 0.02 : -e.deltaY * 0.005;
                zoomTimeline(zoomFactor);
            } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                scrollTimeline(e.deltaX || e.deltaY);
                const transport = transportStore.value;
                if (transport?.isPlaying) {
                    setAutoScroll(false);
                }
            } else {
                const currentY = timelineViewStore.value?.scrollY ?? 0;
                const trackState = trackStore.value;
                const totalTrackHeight = (trackState?.tracks ?? []).reduce((sum, t) => sum + (t.height ?? 64), 0);
                const viewHeight = canvas.clientHeight;
                const maxY = Math.max(0, totalTrackHeight - viewHeight);
                setScrollY(Math.min(maxY, Math.max(0, currentY + e.deltaY)));
            }
        };

        canvas.addEventListener('gesturestart', onGestureStart, { passive: false });
        canvas.addEventListener('gesturechange', onGestureChange, { passive: false });
        canvas.addEventListener('gestureend', onGestureEnd, { passive: false });
        canvas.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            canvas.removeEventListener('gesturestart', onGestureStart);
            canvas.removeEventListener('gesturechange', onGestureChange);
            canvas.removeEventListener('gestureend', onGestureEnd);
            canvas.removeEventListener('wheel', onWheel);
        };
    }, [canvasRef]);
};
