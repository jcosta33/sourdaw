import type {
    CSSProperties,
    KeyboardEvent as ReactKeyboardEvent,
    MouseEvent as ReactMouseEvent,
    ReactElement,
} from 'react';

import { Button } from '#/components/ui/button';

import { MIN_REGION_BEATS, type RegionEdge } from './adjustmentLayerKeyboard';

import type { AdjustmentRegion } from '../../stores/adjustmentLayer';

export type FadePreview = { regionId: string; fadeInBeats: number; fadeOutBeats: number };

type AdjustmentRegionBandProps = {
    region: AdjustmentRegion;
    /** The region's beats as drawn, a drag preview's while one is live. */
    liveRegion: { startBeat: number; endBeat: number };
    style: CSSProperties;
    pixelsPerBeat: number;
    width: number;
    fadePreview: FadePreview | null;
    onContextMenu: (e: ReactMouseEvent) => void;
    onDoubleClick: (e: ReactMouseEvent) => void;
    onDragStart: (e: ReactMouseEvent, kind: 'move' | 'resizeStart' | 'resizeEnd') => void;
    onFadeDragStart: (e: ReactMouseEvent, kind: 'fadeIn' | 'fadeOut') => void;
    onKeyDown: (e: ReactKeyboardEvent<HTMLButtonElement>) => void;
    onEdgeKeyDown: (e: ReactKeyboardEvent<HTMLDivElement>, edge: RegionEdge) => void;
};

export const AdjustmentRegionBand = ({
    region,
    liveRegion,
    style,
    pixelsPerBeat,
    width,
    fadePreview,
    onContextMenu,
    onDoubleClick,
    onDragStart,
    onFadeDragStart,
    onKeyDown,
    onEdgeKeyDown,
}: AdjustmentRegionBandProps): ReactElement => {
    const rangeLabel = `${liveRegion.startBeat.toFixed(2)} to ${liveRegion.endBeat.toFixed(2)}`;
    const { borderColor, ...cellStyle } = style;
    return (
        <div role="gridcell" className="absolute top-0 bottom-0 rounded-sm" style={cellStyle}>
            {/* The band body, edges and fades each open the region's menu and inspector. The cell is handler-free
                so a click on it focuses the layer row, and so owns no border box that those elements do not cover. */}
            <Button
                variant="bare"
                size="bare"
                type="button"
                aria-label={`Adjustment region, beats ${rangeLabel}`}
                aria-keyshortcuts="Enter ArrowLeft ArrowRight Delete ContextMenu Shift+F10"
                className="absolute inset-0 cursor-grab rounded-sm border active:cursor-grabbing"
                style={{ borderColor }}
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                onMouseDown={(e) => onDragStart(e, 'move')}
                onKeyDown={onKeyDown}
            />
            <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Region start"
                aria-valuenow={liveRegion.startBeat}
                aria-valuemin={0}
                aria-valuemax={liveRegion.endBeat - MIN_REGION_BEATS}
                aria-valuetext={`Beat ${liveRegion.startBeat.toFixed(2)}`}
                className="absolute left-0 top-0 bottom-0 w-1 cursor-ew-resize bg-white/40 outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                onMouseDown={(e) => onDragStart(e, 'resizeStart')}
                onKeyDown={(e) => onEdgeKeyDown(e, 'start')}
            />
            <div
                role="separator"
                tabIndex={0}
                aria-orientation="vertical"
                aria-label="Region end"
                aria-valuenow={liveRegion.endBeat}
                aria-valuemin={liveRegion.startBeat + MIN_REGION_BEATS}
                aria-valuetext={`Beat ${liveRegion.endBeat.toFixed(2)}`}
                className="absolute right-0 top-0 bottom-0 w-1 cursor-ew-resize bg-white/40 outline-none focus-visible:ring-1 focus-visible:ring-border-focus/70"
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                onMouseDown={(e) => onDragStart(e, 'resizeEnd')}
                onKeyDown={(e) => onEdgeKeyDown(e, 'end')}
            />
            <FadeTriangles
                region={region}
                pixelsPerBeat={pixelsPerBeat}
                width={width}
                fadePreview={fadePreview}
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                onFadeDragStart={onFadeDragStart}
            />
        </div>
    );
};

type FadeTrianglesProps = {
    region: AdjustmentRegion;
    pixelsPerBeat: number;
    width: number;
    fadePreview: FadePreview | null;
    onContextMenu: (e: ReactMouseEvent) => void;
    onDoubleClick: (e: ReactMouseEvent) => void;
    onFadeDragStart: (e: ReactMouseEvent, kind: 'fadeIn' | 'fadeOut') => void;
};

const FADE_HANDLE_SIZE = 8;

/** The region's fades as drawn, a fade drag preview's while one is live on it. */
const readLiveFade = (
    region: AdjustmentRegion,
    fadePreview: FadePreview | null
): { fadeInBeats: number; fadeOutBeats: number } => {
    if (fadePreview && fadePreview.regionId === region.id) {
        return { fadeInBeats: fadePreview.fadeInBeats, fadeOutBeats: fadePreview.fadeOutBeats };
    }
    return { fadeInBeats: region.fadeInBeats, fadeOutBeats: region.fadeOutBeats };
};

const FadeTriangles = ({
    region,
    pixelsPerBeat,
    width,
    fadePreview,
    onContextMenu,
    onDoubleClick,
    onFadeDragStart,
}: FadeTrianglesProps): ReactElement => {
    const liveFade = readLiveFade(region, fadePreview);
    const fadeInPx = Math.max(0, Math.min(width, liveFade.fadeInBeats * pixelsPerBeat));
    const fadeOutPx = Math.max(0, Math.min(width, liveFade.fadeOutBeats * pixelsPerBeat));

    return (
        <>
            {fadeInPx > 0 ? (
                <svg
                    className="pointer-events-none absolute left-0 top-0 h-full"
                    width={fadeInPx}
                    height="100%"
                    viewBox={`0 0 ${fadeInPx} 20`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <polygon points={`0,20 ${fadeInPx},20 ${fadeInPx},0`} fill="rgba(255,255,255,0.18)" />
                </svg>
            ) : null}
            {fadeOutPx > 0 ? (
                <svg
                    className="pointer-events-none absolute top-0 h-full"
                    style={{ right: 0 }}
                    width={fadeOutPx}
                    height="100%"
                    viewBox={`0 0 ${fadeOutPx} 20`}
                    preserveAspectRatio="none"
                    aria-hidden="true"
                >
                    <polygon points={`0,20 ${fadeOutPx},20 0,0`} fill="rgba(255,255,255,0.18)" />
                </svg>
            ) : null}
            <div
                role="slider"
                aria-label="Fade in"
                aria-valuenow={liveFade.fadeInBeats}
                tabIndex={-1}
                className="absolute top-0 cursor-col-resize bg-white/80"
                style={{
                    left: Math.max(0, fadeInPx - FADE_HANDLE_SIZE / 2),
                    width: FADE_HANDLE_SIZE,
                    height: FADE_HANDLE_SIZE,
                    clipPath: 'polygon(0 0, 100% 0, 100% 100%)',
                }}
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                onMouseDown={(e) => onFadeDragStart(e, 'fadeIn')}
            />
            <div
                role="slider"
                aria-label="Fade out"
                aria-valuenow={liveFade.fadeOutBeats}
                tabIndex={-1}
                className="absolute top-0 cursor-col-resize bg-white/80"
                style={{
                    right: Math.max(0, fadeOutPx - FADE_HANDLE_SIZE / 2),
                    width: FADE_HANDLE_SIZE,
                    height: FADE_HANDLE_SIZE,
                    clipPath: 'polygon(0 0, 100% 0, 0 100%)',
                }}
                onContextMenu={onContextMenu}
                onDoubleClick={onDoubleClick}
                onMouseDown={(e) => onFadeDragStart(e, 'fadeOut')}
            />
        </>
    );
};
