import { type RefObject, useEffect } from 'react';

import { transportStore } from '#/modules/Transport/stores';

import {
    zoomTimeline,
    scrollTimeline,
    setAutoScroll,
    setScrollY,
    setTimelineViewportHeight,
    timelineViewStore,
} from '../../stores/timelineViewStore';

export const useTimelineGestures = (canvasRef: RefObject<HTMLCanvasElement | null>): void => {
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }

        // Trackpad pinch arrives here as a ctrl-modified `wheel` event. The
        // WebKit `gesturestart`/`gesturechange`/`gestureend` trio is not a
        // second source to merge in: Chromium never dispatches it, and every
        // shipped renderer is Chromium.
        const onWheel = (event: WheelEvent): void => {
            event.preventDefault();
            if (event.ctrlKey || event.metaKey) {
                const isPinch = Math.abs(event.deltaY) < 10;
                const zoomFactor = isPinch ? -event.deltaY * 0.02 : -event.deltaY * 0.005;
                zoomTimeline(zoomFactor);
            } else if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
                scrollTimeline(event.deltaX || event.deltaY);
                const transport = transportStore.value;
                if (transport?.isPlaying) {
                    setAutoScroll(false);
                }
            } else {
                // Let setScrollY perform the single authoritative clamp using the
                // real viewport height. Report it first so the clamp uses this
                // canvas's actual size rather than whatever another view last
                // reported (or the store's cold-start default).
                const currentY = timelineViewStore.value?.scrollY ?? 0;
                setTimelineViewportHeight(canvas.clientHeight);
                setScrollY(currentY + event.deltaY);
            }
        };

        canvas.addEventListener('wheel', onWheel, { passive: false });

        return () => {
            canvas.removeEventListener('wheel', onWheel);
        };
    }, [canvasRef]);
};
