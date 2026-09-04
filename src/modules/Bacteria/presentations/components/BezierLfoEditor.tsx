/**
 * BezierLfoEditor — ShaperBox-style custom LFO curve editor.
 *
 * Users draw arbitrary LFO shapes using cubic Bezier curves with
 * grid snapping and tempo sync. Supports rhythmic ducking patterns.
 */
import { type ReactElement, useRef, useEffect, useState } from 'react';

type Point = { x: number; y: number };

type LfoPoint = {
    pos: Point; // (0-1, 0-1) normalized position
    cp1: Point; // control point before
    cp2: Point; // control point after
};

type BezierLfoEditorProps = {
    width: number;
    height: number;
    points: LfoPoint[];
    onPointsChange: (points: LfoPoint[]) => void;
    gridDivisions?: number;
    tempoSync?: boolean;
};

// Control-handle x positions stay inside [0,1]: fromCanvas() clamps any dragged
// handle to that range, so a default outside it (e.g. x:-0.05 / x:1.05) can never
// be restored once the user grabs it — keep defaults reachable.
export const DEFAULT_POINTS: LfoPoint[] = [
    { pos: { x: 0, y: 0.5 }, cp1: { x: 0, y: 0.5 }, cp2: { x: 0.1, y: 0.9 } },
    { pos: { x: 0.25, y: 1 }, cp1: { x: 0.15, y: 1 }, cp2: { x: 0.35, y: 1 } },
    { pos: { x: 0.5, y: 0.5 }, cp1: { x: 0.4, y: 0.1 }, cp2: { x: 0.6, y: 0.5 } },
    { pos: { x: 0.75, y: 0 }, cp1: { x: 0.65, y: 0 }, cp2: { x: 0.85, y: 0 } },
    { pos: { x: 1, y: 0.5 }, cp1: { x: 0.9, y: 0.1 }, cp2: { x: 1, y: 0.5 } },
];

export const BezierLfoEditor = ({
    width,
    height,
    points: initialPoints,
    onPointsChange,
    gridDivisions = 8,
    tempoSync = false,
}: BezierLfoEditorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [points, setPoints] = useState<LfoPoint[]>(initialPoints.length > 0 ? initialPoints : DEFAULT_POINTS);
    const dragRef = useRef<{ pointIdx: number; part: 'pos' | 'cp1' | 'cp2' } | null>(null);

    const toCanvas = (p: Point): Point => ({
        x: p.x * width,
        y: (1 - p.y) * height,
    });

    const fromCanvas = (cx: number, cy: number): Point => ({
        x: Math.max(0, Math.min(1, cx / width)),
        y: Math.max(0, Math.min(1, 1 - cy / height)),
    });

    const draw = (): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 0; i <= gridDivisions; i++) {
            const x = (i / gridDivisions) * width;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
        for (let i = 0; i <= 4; i++) {
            const y = (i / 4) * height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Draw curve
        if (points.length >= 2) {
            ctx.strokeStyle = 'rgb(244, 63, 94)';
            ctx.lineWidth = 2;
            ctx.beginPath();

            const first = toCanvas(points[0]!.pos);
            ctx.moveTo(first.x, first.y);

            for (let i = 0; i < points.length - 1; i++) {
                const cp2 = toCanvas(points[i]!.cp2);
                const cp1Next = toCanvas(points[i + 1]!.cp1);
                const pNext = toCanvas(points[i + 1]!.pos);
                ctx.bezierCurveTo(cp2.x, cp2.y, cp1Next.x, cp1Next.y, pNext.x, pNext.y);
            }
            ctx.stroke();

            // Fill under curve
            ctx.lineTo(width, height);
            ctx.lineTo(0, height);
            ctx.closePath();
            ctx.fillStyle = 'rgba(244, 63, 94, 0.08)';
            ctx.fill();
        }

        // Draw points and handles
        for (let i = 0; i < points.length; i++) {
            const p = points[i]!;
            const cp = toCanvas(p.pos);

            // Control lines
            ctx.strokeStyle = 'rgba(244, 63, 94, 0.25)';
            ctx.lineWidth = 1;
            const c1 = toCanvas(p.cp1);
            const c2 = toCanvas(p.cp2);
            ctx.beginPath();
            ctx.moveTo(c1.x, c1.y);
            ctx.lineTo(cp.x, cp.y);
            ctx.lineTo(c2.x, c2.y);
            ctx.stroke();

            // Control point dots
            for (const c of [c1, c2]) {
                ctx.fillStyle = 'rgba(244, 63, 94, 0.6)';
                ctx.beginPath();
                ctx.arc(c.x, c.y, 3, 0, Math.PI * 2);
                ctx.fill();
            }

            // Main point
            ctx.fillStyle = 'white';
            ctx.beginPath();
            ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
            ctx.fill();
        }
    };

    // §150.2 — Only redraw when the inputs that influence the canvas change;
    // previously this effect had no dependency array so it ran after every
    // parent re-render even when nothing visible changed.
    useEffect(() => {
        draw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [points, width, height, tempoSync]);

    const handlePointerDown = (e: React.PointerEvent): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        for (let i = 0; i < points.length; i++) {
            const p = points[i]!;
            for (const part of ['pos', 'cp1', 'cp2'] as const) {
                const cp = toCanvas(p[part]);
                if (Math.sqrt((cx - cp.x) ** 2 + (cy - cp.y) ** 2) < 8) {
                    dragRef.current = { pointIdx: i, part };
                    e.currentTarget.setPointerCapture(e.pointerId);
                    return;
                }
            }
        }
    };

    const handlePointerMove = (e: React.PointerEvent): void => {
        if (!dragRef.current) {
            return;
        }
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const newPoint = fromCanvas(e.clientX - rect.left, e.clientY - rect.top);

        // Snap to grid if close
        const snapX = Math.round(newPoint.x * gridDivisions) / gridDivisions;
        if (Math.abs(newPoint.x - snapX) < 0.02) {
            newPoint.x = snapX;
        }
        const snapY = Math.round(newPoint.y * 4) / 4;
        if (Math.abs(newPoint.y - snapY) < 0.03) {
            newPoint.y = snapY;
        }

        const newPoints = [...points];
        const pt = { ...newPoints[dragRef.current.pointIdx]! };
        pt[dragRef.current.part] = newPoint;
        newPoints[dragRef.current.pointIdx] = pt;
        setPoints(newPoints);
    };

    const handlePointerUp = (): void => {
        if (dragRef.current) {
            onPointsChange(points);
            dragRef.current = null;
        }
    };

    const handlePointerCancel = (): void => {
        dragRef.current = null;
    };

    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="rounded-lg border border-border/30 cursor-crosshair"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
            />
            <span className="absolute top-1 left-1 text-nano text-muted-foreground/30 font-mono">
                {tempoSync ? 'LFO (Tempo Sync)' : 'LFO Shape'}
            </span>
        </div>
    );
};
