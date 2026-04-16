import { type ReactElement, useRef, useEffect } from 'react';
import { useStore } from '#/infra/store/useStore';
import { libraryStore } from '../../stores/libraryStore';

type SpatialMapRendererProps = {
    width: number;
    height: number;
    onSampleClick?: (sampleId: string) => void;
};

/**
 * 2D Spatial Map renderer.
 * R-G3: Browse samples by Timbral Proximity.
 */
export const SpatialMapRenderer = ({
    width,
    height,
    onSampleClick,
}: SpatialMapRendererProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const libState = useStore(libraryStore, {
        roots: [],
        samples: [],
        folderTrees: {},
        activeRootId: null,
        currentFolder: null,
        searchQuery: '',
        tagFilter: null,
        favoritesOnly: false,
        sortField: 'name',
        sortDirection: 'asc',
        scanning: false,
        scanProgress: 0,
    });

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, width, height);

        for (const sample of libState.samples) {
            if (!sample.spatialMap) continue;

            const x = (sample.spatialMap.x + 1) * 0.5 * width;
            const y = (sample.spatialMap.y + 1) * 0.5 * height;

            ctx.fillStyle = sample.favorite ? 'var(--color-accent-gold)' : 'rgba(255, 255, 255, 0.4)';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();

            if (sample.favorite) {
                ctx.strokeStyle = 'white';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
        }
    }, [libState.samples, width, height]);

    const handleClick = (e: React.MouseEvent) => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;

        // Hit test
        for (const sample of libState.samples) {
            if (!sample.spatialMap) continue;
            const x = (sample.spatialMap.x + 1) * 0.5 * width;
            const y = (sample.spatialMap.y + 1) * 0.5 * height;
            const dist = Math.sqrt((x - mx) ** 2 + (y - my) ** 2);
            if (dist < 8) {
                onSampleClick?.(sample.id);
                break;
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
