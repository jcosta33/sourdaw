export type WarpMarkerView = {
    id: string;
    originalBeat: number;
    warpedBeat: number;
    origin?: 'user' | 'transient-auto' | 'grid-snap';
    confidence?: number;
    locked?: boolean;
};

const VIRTUALIZE_THRESHOLD = 200;
// Chromium 73+ per-side canvas limit: a 2D canvas wider or taller than this many backing pixels stays blank.
const MAX_CANVAS_DIMENSION = 65535;
// Chromium 73+ canvas area limit: 16384 x 16384 backing pixels.
const MAX_CANVAS_AREA = 268435456;
const PEAK_BIN_MARGIN = 16;

export function visibleMarkers(
    markers: ReadonlyArray<WarpMarkerView>,
    beatWidth: number,
    scrollLeft: number,
    containerWidth: number
): WarpMarkerView[] {
    if (markers.length <= VIRTUALIZE_THRESHOLD || containerWidth <= 0) {
        return [...markers];
    }
    const minX = scrollLeft - 16;
    const maxX = scrollLeft + containerWidth + 16;
    return markers.filter((m) => {
        const x = m.warpedBeat * beatWidth;
        return x >= minX && x <= maxX;
    });
}

type XRange = { startX: number; endX: number };

/** The parts of [0, width] outside every audible window, left to right. */
export function dimmedRanges(windows: readonly XRange[], width: number): { x: number; width: number }[] {
    const ranges: { x: number; width: number }[] = [];
    let cursor = 0;
    for (const window of windows) {
        const start = Math.min(window.startX, width);
        if (start > cursor) {
            ranges.push({ x: cursor, width: start - cursor });
        }
        cursor = Math.max(cursor, window.endX);
    }
    if (cursor < width) {
        ranges.push({ x: cursor, width: width - cursor });
    }
    return ranges;
}

/** Inclusive peak-bin span covering the viewport plus a margin; every bin while the viewport is unmeasured. */
export function visibleBinRange(
    scrollLeft: number,
    viewportWidth: number,
    binCount: number
): { first: number; last: number } {
    if (viewportWidth <= 0) {
        return { first: 0, last: binCount - 1 };
    }
    return {
        first: Math.max(0, Math.floor(scrollLeft) - PEAK_BIN_MARGIN),
        last: Math.min(binCount - 1, Math.ceil(scrollLeft + viewportWidth) + PEAK_BIN_MARGIN),
    };
}

export function backingPixelRatio(devicePixelRatio: number, width: number, height: number): number {
    return Math.min(
        devicePixelRatio,
        MAX_CANVAS_DIMENSION / width,
        MAX_CANVAS_DIMENSION / height,
        Math.sqrt(MAX_CANVAS_AREA / (width * height))
    );
}

export function strokeBeatGrid(
    ctx: CanvasRenderingContext2D,
    { width, height, beatWidth }: { width: number; height: number; beatWidth: number },
    style: string,
    includesBeat: (beat: number) => boolean
): void {
    ctx.strokeStyle = style;
    ctx.beginPath();
    for (let beat = 0; beat < width / beatWidth; beat++) {
        if (includesBeat(beat)) {
            ctx.moveTo(beat * beatWidth, 0);
            ctx.lineTo(beat * beatWidth, height);
        }
    }
    ctx.stroke();
}

export function markerColor(marker: WarpMarkerView): string {
    const origin = marker.origin ?? 'user';
    if (origin === 'transient-auto') {
        const confidence = marker.confidence ?? 1;
        const alpha = 0.35 + 0.55 * Math.max(0, Math.min(1, confidence));
        return `rgba(99, 160, 214, ${alpha.toFixed(2)})`;
    }
    if (origin === 'grid-snap') {
        return 'rgba(120, 190, 130, 0.85)';
    }
    return 'rgba(220, 150, 60, 0.9)';
}
