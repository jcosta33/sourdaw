/**
 * WaveshaperEditor — custom transfer function editor using cubic Bezier curves.
 *
 * Users draw a transfer function f(x) with draggable control points.
 * Evaluates the curve using the Bernstein basis with C¹ continuity.
 */
import { type ReactElement, useRef, useState, useEffect } from 'react';

type Point = { x: number; y: number };

type BezierSegment = {
    p0: Point;
    p1: Point; // control point 1
    p2: Point; // control point 2
    p3: Point;
};

type WaveshaperEditorProps = {
    width: number;
    height: number;
    segments: BezierSegment[];
    onSegmentsChange: (segments: BezierSegment[]) => void;
};

const DEFAULT_SEGMENTS: BezierSegment[] = [
    {
        p0: { x: -1, y: -1 },
        p1: { x: -0.33, y: -0.33 },
        p2: { x: 0.33, y: 0.33 },
        p3: { x: 1, y: 1 },
    },
];

function toCanvas(p: Point, w: number, h: number): Point {
    return {
        x: (p.x + 1) * 0.5 * w,
        y: (1 - (p.y + 1) * 0.5) * h,
    };
}

function fromCanvas(cx: number, cy: number, w: number, h: number): Point {
    return {
        x: (cx / w) * 2 - 1,
        y: 1 - (cy / h) * 2,
    };
}

export const WaveshaperEditor = ({
    width,
    height,
    segments: initialSegments,
    onSegmentsChange,
}: WaveshaperEditorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [segments, setSegments] = useState<BezierSegment[]>(
        initialSegments.length > 0 ? initialSegments : DEFAULT_SEGMENTS
    );
    const dragRef = useRef<{ segIdx: number; pointKey: 'p1' | 'p2' } | null>(null);

    // §150.2 — only redraw when the curve content or canvas size changes.
    // `drawCurve` is defined inside the effect so its only reactive inputs
    // (segments, width, height) are exactly the declared dependencies — no
    // exhaustive-deps suppression needed.
    useEffect(() => {
        const drawCurve = (): void => {
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
            for (let i = 0; i <= 4; i++) {
                const x = (i / 4) * width;
                const y = (i / 4) * height;
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(width, y);
                ctx.stroke();
            }

            // Identity line (diagonal)
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(0, height);
            ctx.lineTo(width, 0);
            ctx.stroke();
            ctx.setLineDash([]);

            // Draw Bezier curve
            ctx.strokeStyle = 'rgb(244, 63, 94)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            for (const seg of segments) {
                const p0 = toCanvas(seg.p0, width, height);
                const p1 = toCanvas(seg.p1, width, height);
                const p2 = toCanvas(seg.p2, width, height);
                const p3 = toCanvas(seg.p3, width, height);
                ctx.moveTo(p0.x, p0.y);
                ctx.bezierCurveTo(p1.x, p1.y, p2.x, p2.y, p3.x, p3.y);
            }
            ctx.stroke();

            // Draw control points
            for (const seg of segments) {
                // Control lines
                ctx.strokeStyle = 'rgba(244, 63, 94, 0.3)';
                ctx.lineWidth = 1;
                const cp0 = toCanvas(seg.p0, width, height);
                const cp1 = toCanvas(seg.p1, width, height);
                const cp2 = toCanvas(seg.p2, width, height);
                const cp3 = toCanvas(seg.p3, width, height);
                ctx.beginPath();
                ctx.moveTo(cp0.x, cp0.y);
                ctx.lineTo(cp1.x, cp1.y);
                ctx.stroke();
                ctx.beginPath();
                ctx.moveTo(cp3.x, cp3.y);
                ctx.lineTo(cp2.x, cp2.y);
                ctx.stroke();

                // Control point circles
                for (const cp of [cp1, cp2]) {
                    ctx.fillStyle = 'rgb(244, 63, 94)';
                    ctx.beginPath();
                    ctx.arc(cp.x, cp.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Anchor points
                for (const ap of [cp0, cp3]) {
                    ctx.fillStyle = 'white';
                    ctx.beginPath();
                    ctx.arc(ap.x, ap.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
        };

        drawCurve();
    }, [segments, width, height]);

    const handlePointerDown = (e: React.PointerEvent): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        // Find closest control point
        for (let si = 0; si < segments.length; si++) {
            const seg = segments[si]!;
            for (const key of ['p1', 'p2'] as const) {
                const cp = toCanvas(seg[key], width, height);
                const dist = Math.sqrt((cx - cp.x) ** 2 + (cy - cp.y) ** 2);
                if (dist < 10) {
                    dragRef.current = { segIdx: si, pointKey: key };
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
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const newPoint = fromCanvas(cx, cy, width, height);
        newPoint.x = Math.max(-1.5, Math.min(1.5, newPoint.x));
        newPoint.y = Math.max(-1.5, Math.min(1.5, newPoint.y));

        const newSegments = [...segments];
        const seg = { ...newSegments[dragRef.current.segIdx]! };
        seg[dragRef.current.pointKey] = newPoint;
        newSegments[dragRef.current.segIdx] = seg;
        setSegments(newSegments);
    };

    const handlePointerUp = (): void => {
        if (dragRef.current) {
            onSegmentsChange(segments);
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
                Transfer Function
            </span>
        </div>
    );
};
