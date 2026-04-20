/**
 * Slice marker overlay rendered on top of the waveform.
 * Markers are draggable for repositioning.
 */

import { type ReactElement } from 'react';

import type { SliceMarker } from '../../models/CrumbsTypes';

type SliceOverlayProps = {
    markers: SliceMarker[];
    totalFrames: number;
    activeSliceIndex: number;
    width: number;
    height: number;
    onMarkerDrag: (id: string, framePosition: number) => void;
    onSelectSlice: (index: number) => void;
};

export const SliceOverlay = ({
    markers,
    totalFrames,
    activeSliceIndex,
    width,
    height,
    onMarkerDrag,
    onSelectSlice,
}: SliceOverlayProps): ReactElement => {
    if (totalFrames === 0) {
        return <div />;
    }

    function handlePointerDown(index: number, markerId: string, e: React.PointerEvent): void {
        const marker = markers[index];
        if (!marker) {
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        onSelectSlice(index);

        const startX = e.clientX;
        const startFrame = marker.framePosition;
        const container = (e.target as HTMLElement).parentElement;
        if (!container) {
            return;
        }

        const containerRect = container.getBoundingClientRect();

        function onMove(moveEvent: PointerEvent): void {
            const dx = moveEvent.clientX - startX;
            const frameDelta = (dx / containerRect.width) * totalFrames;
            const newFrame = Math.max(0, Math.min(totalFrames, Math.round(startFrame + frameDelta)));
            onMarkerDrag(markerId, newFrame);
        }

        function onUp(): void {
            document.removeEventListener('pointermove', onMove);
            document.removeEventListener('pointerup', onUp);
        }

        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    }

    return (
        <div className="pointer-events-none absolute inset-0" style={{ width, height }}>
            {markers.map((marker, index) => {
                const x = (marker.framePosition / totalFrames) * width;
                const isActive = index === activeSliceIndex;
                return (
                    <div
                        key={marker.id}
                        className="pointer-events-auto absolute top-0 cursor-col-resize"
                        style={{
                            left: x - 4,
                            width: 8,
                            height,
                        }}
                        onPointerDown={(e) => handlePointerDown(index, marker.id, e)}
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
