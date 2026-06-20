/**
 * Slice marker overlay rendered on top of the waveform.
 * Markers are draggable for repositioning.
 */

import { type ReactElement, useRef } from 'react';

import type { SliceMarker } from '../../models/CrumbsTypes';

type SliceOverlayProps = {
    markers: SliceMarker[];
    totalFrames: number;
    activeSliceIndex: number;
    height: number;
    onMarkerDrag: (id: string, framePosition: number) => void;
    onSelectSlice: (index: number) => void;
};

/** One frame-position nudge per arrow-key press for keyboard marker adjustment. */
const KEYBOARD_NUDGE_FRAMES = 1;

export const SliceOverlay = ({
    markers,
    totalFrames,
    activeSliceIndex,
    height,
    onMarkerDrag,
    onSelectSlice,
}: SliceOverlayProps): ReactElement => {
    // The overlay sizes itself to its parent (inset-0) so the marker math agrees
    // with the fluid w-full canvas underneath. We measure this element live per
    // drag move so a panel resize / scroll / DPR change mid-drag uses the current
    // frame, not a rect cached at pointerdown.
    const overlayRef = useRef<HTMLDivElement>(null);

    if (totalFrames === 0) {
        return <div />;
    }

    function handlePointerDown(index: number, markerId: string, e: React.PointerEvent<HTMLDivElement>): void {
        const marker = markers[index];
        if (!marker) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        onSelectSlice(index);

        const target = e.currentTarget;
        const pointerId = e.pointerId;
        target.setPointerCapture(pointerId);

        const startX = e.clientX;
        const startFrame = marker.framePosition;

        function onMove(moveEvent: PointerEvent): void {
            const overlay = overlayRef.current;
            if (!overlay) {
                return;
            }
            // Re-measure every move so a resize/scroll during the drag scales the
            // delta against the current width rather than a stale one.
            const width = overlay.getBoundingClientRect().width;
            if (width === 0) {
                return;
            }
            const dx = moveEvent.clientX - startX;
            const frameDelta = (dx / width) * totalFrames;
            const newFrame = Math.max(0, Math.min(totalFrames, Math.round(startFrame + frameDelta)));
            onMarkerDrag(markerId, newFrame);
        }

        function onUp(): void {
            target.removeEventListener('pointermove', onMove);
            target.removeEventListener('pointerup', onUp);
            if (target.hasPointerCapture(pointerId)) {
                target.releasePointerCapture(pointerId);
            }
        }

        target.addEventListener('pointermove', onMove);
        target.addEventListener('pointerup', onUp);
    }

    function handleKeyDown(index: number, marker: SliceMarker, e: React.KeyboardEvent): void {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            onSelectSlice(index);
            const step = e.key === 'ArrowLeft' ? -KEYBOARD_NUDGE_FRAMES : KEYBOARD_NUDGE_FRAMES;
            const newFrame = Math.max(0, Math.min(totalFrames, marker.framePosition + step));
            onMarkerDrag(marker.id, newFrame);
        } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            onSelectSlice(index);
        }
    }

    return (
        <div ref={overlayRef} className="pointer-events-none absolute inset-0" style={{ height }}>
            {markers.map((marker, index) => {
                const x = (marker.framePosition / totalFrames) * 100;
                const isActive = index === activeSliceIndex;
                return (
                    <div
                        key={marker.id}
                        role="slider"
                        tabIndex={0}
                        aria-label={`Slice marker ${marker.label}`}
                        aria-valuemin={0}
                        aria-valuemax={totalFrames}
                        aria-valuenow={marker.framePosition}
                        className="pointer-events-auto absolute top-0 cursor-col-resize"
                        style={{
                            left: `calc(${x}% - 4px)`,
                            width: 8,
                            height,
                        }}
                        onPointerDown={(e) => handlePointerDown(index, marker.id, e)}
                        onKeyDown={(e) => handleKeyDown(index, marker, e)}
                    >
                        <div
                            className="absolute left-1/2 top-0 w-px"
                            style={{
                                height,
                                backgroundColor: isActive ? 'rgba(96, 200, 224, 0.9)' : 'rgba(96, 200, 224, 0.4)',
                            }}
                        />
                        <div
                            className="absolute left-1/2 top-0 -translate-x-1/2 rounded-b px-1 text-[7px] font-bold"
                            style={{
                                backgroundColor: isActive ? 'rgba(96, 200, 224, 0.6)' : 'rgba(96, 200, 224, 0.25)',
                                color: 'white',
                            }}
                        >
                            {marker.label}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};
