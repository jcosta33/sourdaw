/**
 * XY Pad — two-axis performance controller.
 * Maps X/Y position to two macro parameters for expressive real-time control.
 * Sits alongside the macro strip in the Play level.
 */
import { type ReactElement, useRef, useCallback, useEffect } from 'react';

type XYPadProps = {
    xValue: number;  // 0-1
    yValue: number;  // 0-1
    xLabel?: string;
    yLabel?: string;
    onXChange: (v: number) => void;
    onYChange: (v: number) => void;
    size?: number;
};

export const XYPad = ({
    xValue, yValue, xLabel = 'X', yLabel = 'Y',
    onXChange, onYChange, size = 120,
}: XYPadProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const draggingRef = useRef(false);

    const handlePointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, 1 - (e.clientY - rect.top) / rect.height)); // invert Y
        onXChange(x);
        onYChange(y);
    }, [onXChange, onYChange]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        // Always reset canvas dimensions — this also clears the context transform
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        // Reset transform before scaling to prevent accumulation across renders
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.scale(dpr, dpr);

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, size, size);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(size / 2, 0); ctx.lineTo(size / 2, size);
        ctx.moveTo(0, size / 2); ctx.lineTo(size, size / 2);
        ctx.stroke();

        // Axis labels
        ctx.font = '7px system-ui';
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.textAlign = 'center';
        ctx.fillText(xLabel, size / 2, size - 3);
        ctx.save();
        ctx.translate(8, size / 2);
        ctx.rotate(-Math.PI / 2);
        ctx.fillText(yLabel, 0, 0);
        ctx.restore();

        // Puck position (Y inverted for screen coords)
        const px = xValue * size;
        const py = (1 - yValue) * size;

        // Crosshairs
        ctx.strokeStyle = 'rgba(168, 130, 255, 0.2)';
        ctx.beginPath();
        ctx.moveTo(px, 0); ctx.lineTo(px, size);
        ctx.moveTo(0, py); ctx.lineTo(size, py);
        ctx.stroke();

        // Glow
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 15);
        glow.addColorStop(0, 'rgba(168, 130, 255, 0.4)');
        glow.addColorStop(1, 'rgba(168, 130, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(px - 15, py - 15, 30, 30);

        // Dot
        ctx.fillStyle = '#A882FF';
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fill();
    }, [xValue, yValue, xLabel, yLabel, size]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width: size, height: size, cursor: draggingRef.current ? 'grabbing' : 'grab' }}
            className="rounded-lg border border-border/30"
            onPointerDown={(e) => {
                draggingRef.current = true;
                (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                handlePointer(e);
            }}
            onPointerMove={(e) => { if (draggingRef.current) handlePointer(e); }}
            onPointerUp={() => { draggingRef.current = false; }}
            onPointerCancel={() => { draggingRef.current = false; }}
        />
    );
};
