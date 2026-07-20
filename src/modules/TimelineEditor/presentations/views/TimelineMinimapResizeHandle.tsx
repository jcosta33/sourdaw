import { type KeyboardEvent, type PointerEvent, type ReactElement, useEffect, useRef } from 'react';

import { Divider } from '#/components/layout/Divider';
import {
    normalizeTimelineMinimapHeight,
    TIMELINE_MINIMAP_MAX_HEIGHT,
    TIMELINE_MINIMAP_MIN_HEIGHT,
} from '#/utils/TimelineMinimap/timelineMinimapHeight';

type TimelineMinimapResizeHandleProps = {
    height: number;
    persistedHeight: number;
    onPreview: (height: number) => void;
    onCommit: (height: number) => void;
    onCancel: () => void;
};

type ActiveResize = {
    element: HTMLDivElement;
    pointerId: number;
    startClientY: number;
    startHeight: number;
    startPersistedHeight: number;
};

export const TimelineMinimapResizeHandle = ({
    height,
    persistedHeight,
    onPreview,
    onCommit,
    onCancel,
}: TimelineMinimapResizeHandleProps): ReactElement => {
    const normalizedHeight = normalizeTimelineMinimapHeight(height);
    const activeResizeRef = useRef<ActiveResize | null>(null);
    const onCancelRef = useRef(onCancel);

    useEffect(() => {
        onCancelRef.current = onCancel;
    }, [onCancel]);

    const releaseCapture = (resize: ActiveResize): void => {
        if (!resize.element.hasPointerCapture(resize.pointerId)) {
            return;
        }

        resize.element.releasePointerCapture(resize.pointerId);
    };

    const cancelActiveResize = (): void => {
        const resize = activeResizeRef.current;
        if (!resize) {
            return;
        }

        activeResizeRef.current = null;
        releaseCapture(resize);
        onCancelRef.current();
    };

    useEffect(() => {
        const resize = activeResizeRef.current;
        if (!resize || resize.startPersistedHeight === persistedHeight) {
            return;
        }

        activeResizeRef.current = null;
        releaseCapture(resize);
        onCancelRef.current();
    }, [persistedHeight]);

    useEffect(() => {
        return () => {
            const resize = activeResizeRef.current;
            if (!resize) {
                return;
            }

            activeResizeRef.current = null;
            releaseCapture(resize);
            onCancelRef.current();
        };
    }, []);

    const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
        if (event.button !== 0 || event.isPrimary === false || activeResizeRef.current) {
            return;
        }

        event.preventDefault();
        const startHeight = normalizedHeight;
        activeResizeRef.current = {
            element: event.currentTarget,
            pointerId: event.pointerId,
            startClientY: event.clientY,
            startHeight,
            startPersistedHeight: persistedHeight,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
        const resize = activeResizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        const nextHeight = normalizeTimelineMinimapHeight(resize.startHeight + resize.startClientY - event.clientY);
        onPreview(nextHeight);
    };

    const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
        const resize = activeResizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) {
            return;
        }

        event.preventDefault();
        activeResizeRef.current = null;
        releaseCapture(resize);
        if (resize.startPersistedHeight !== persistedHeight) {
            onCancelRef.current();
            return;
        }

        const releaseHeight = normalizeTimelineMinimapHeight(resize.startHeight + resize.startClientY - event.clientY);
        onCommit(releaseHeight);
    };

    const handlePointerCancel = (event: PointerEvent<HTMLDivElement>): void => {
        const resize = activeResizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) {
            return;
        }

        cancelActiveResize();
    };

    const handleLostPointerCapture = (event: PointerEvent<HTMLDivElement>): void => {
        const resize = activeResizeRef.current;
        if (!resize || resize.pointerId !== event.pointerId) {
            return;
        }

        activeResizeRef.current = null;
        onCancelRef.current();
    };

    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        let nextHeight: number | null = null;
        const step = event.shiftKey ? 1 : 4;

        if (event.key === 'ArrowUp') {
            nextHeight = normalizeTimelineMinimapHeight(normalizedHeight + step);
        } else if (event.key === 'ArrowDown') {
            nextHeight = normalizeTimelineMinimapHeight(normalizedHeight - step);
        } else if (event.key === 'Home') {
            nextHeight = TIMELINE_MINIMAP_MIN_HEIGHT;
        } else if (event.key === 'End') {
            nextHeight = TIMELINE_MINIMAP_MAX_HEIGHT;
        }

        if (nextHeight === null) {
            return;
        }

        event.preventDefault();
        if (nextHeight !== normalizedHeight) {
            onCommit(nextHeight);
        }
    };

    return (
        <Divider
            axis="x"
            className="group absolute inset-x-0 bottom-0 z-10 h-1 cursor-row-resize touch-none border-0 bg-transparent p-0"
            style={{ touchAction: 'none' }}
            aria-label="Resize timeline minimap"
            aria-valuemin={TIMELINE_MINIMAP_MIN_HEIGHT}
            aria-valuemax={TIMELINE_MINIMAP_MAX_HEIGHT}
            aria-valuenow={normalizedHeight}
            tabIndex={0}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            onLostPointerCapture={handleLostPointerCapture}
            onKeyDown={handleKeyDown}
        >
            <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border/40 transition-colors group-hover:bg-ring/60 group-focus-visible:bg-ring" />
        </Divider>
    );
};
