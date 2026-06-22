import { type ReactElement, useRef, useEffect } from 'react';

import { useStore } from '#/infra/store/useStore';

import { type SampleRecord } from '../../models/LibraryTypes';
import { defaultLibraryState, libraryStore } from '../../stores/libraryStore';

type SpatialMapRendererProps = {
    width: number;
    height: number;
    onSampleClick?: (sampleId: string) => void;
};

const HIT_RADIUS = 8;

type Plotted = { id: string; x: number; y: number; favorite: boolean };

/** Project a sample's normalized (-1..1) map coordinate into canvas pixels. */
function project(sample: SampleRecord, width: number, height: number): Plotted | null {
    if (!sample.spatialMap) {
        return null;
    }
    return {
        id: sample.id,
        x: (sample.spatialMap.x + 1) * 0.5 * width,
        y: (sample.spatialMap.y + 1) * 0.5 * height,
        favorite: sample.favorite,
    };
}

/**
 * 2D Spatial Map renderer.
 * R-G3: Browse samples by Timbral Proximity.
 */
export const SpatialMapRenderer = ({ width, height, onSampleClick }: SpatialMapRendererProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const libState = useStore(libraryStore, defaultLibraryState);

    // The accent-gold token is static for the app's lifetime; read it once on
    // mount rather than on every redraw. getComputedStyle forces a style flush,
    // so keeping it out of the per-samples draw effect avoids paying that cost
    // each time the sample set changes.
    const accentGoldRef = useRef<string>('#d4a017');
    useEffect(() => {
        const canvas = canvasRef.current;
        if (canvas) {
            accentGoldRef.current =
                getComputedStyle(canvas).getPropertyValue('--color-accent-gold').trim() || '#d4a017';
        }
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, width, height);
        const accentGold = accentGoldRef.current;

        for (const sample of libState.samples) {
            const p = project(sample, width, height);
            if (!p) {
                continue;
            }
            ctx.fillStyle = p.favorite ? accentGold : 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();

            if (p.favorite) {
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }, [libState.samples, width, height]);

    const handleClick = (e: React.MouseEvent): void => {
        const canvas = canvasRef.current;
        const rect = canvas?.getBoundingClientRect();
        if (!canvas || !rect) {
            return;
        }
        const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
        const my = (e.clientY - rect.top) * (canvas.height / rect.height);

        // Bucket the plotted points into a uniform grid keyed by hit-radius-sized
        // cells, then probe only the clicked cell and its neighbours instead of
        // distance-testing every sample. Built per click (a rare event) so no
        // render-time memoization is needed.
        const cellSize = HIT_RADIUS;
        const grid = new Map<string, Plotted[]>();
        const cellKey = (cx: number, cy: number): string => `${cx},${cy}`;
        for (const sample of libState.samples) {
            const p = project(sample, width, height);
            if (!p) {
                continue;
            }
            const k = cellKey(Math.floor(p.x / cellSize), Math.floor(p.y / cellSize));
            const bucket = grid.get(k);
            if (bucket) {
                bucket.push(p);
            } else {
                grid.set(k, [p]);
            }
        }

        const cx = Math.floor(mx / cellSize);
        const cy = Math.floor(my / cellSize);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                const bucket = grid.get(cellKey(cx + dx, cy + dy));
                if (!bucket) {
                    continue;
                }
                for (const p of bucket) {
                    const dist = Math.sqrt((p.x - mx) ** 2 + (p.y - my) ** 2);
                    if (dist < HIT_RADIUS) {
                        onSampleClick?.(p.id);
                        return;
                    }
                }
            }
        }
    };

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            onClick={handleClick}
            className="cursor-crosshair bg-surface-base/50 rounded-lg"
        />
    );
};
