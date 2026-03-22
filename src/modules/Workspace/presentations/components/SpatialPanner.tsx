/**
 * Spatial Audio Panner component.
 * 2D top-down view with a draggable dot representing the audio source position.
 * Listener is at the center. Shows azimuth circle, distance rings, and L/R labels.
 */
import { type ReactElement, useRef, useState, useEffect } from 'react';

type SpatialPannerProps = {
    size?: number;
    /** Initial azimuth in degrees (0 = front, 90 = right, -90 = left, 180 = behind) */
    azimuth?: number;
    /** Initial distance 0-1 (0 = center, 1 = edge) */
    distance?: number;
    onChange?: (azimuth: number, distance: number) => void;
    color?: string;
};

export const SpatialPanner = ({
    size = 120,
    azimuth: initialAzimuth = 0,
    distance: initialDistance = 0.5,
    onChange,
    color = '#4a7090',
}: SpatialPannerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [azimuth, setAzimuth] = useState(initialAzimuth);
    const [distance, setDistance] = useState(initialDistance);
    const dragging = useRef(false);

    const cx = size / 2;
    const cy = size / 2;
    const maxRadius = size * 0.42;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, size, size);

        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.beginPath();
        ctx.arc(cx, cy, maxRadius + 4, 0, Math.PI * 2);
        ctx.fill();

        // Distance rings
        ctx.strokeStyle = '#1a1a1a';
        ctx.lineWidth = 0.5;
        for (const r of [0.25, 0.5, 0.75, 1.0]) {
            ctx.beginPath();
            ctx.arc(cx, cy, maxRadius * r, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Crosshair
        ctx.beginPath();
        ctx.moveTo(cx - maxRadius, cy);
        ctx.lineTo(cx + maxRadius, cy);
        ctx.moveTo(cx, cy - maxRadius);
        ctx.lineTo(cx, cy + maxRadius);
        ctx.stroke();

        // Labels
        ctx.fillStyle = '#3a3a3a';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('F', cx, cy - maxRadius - 2);
        ctx.fillText('B', cx, cy + maxRadius + 8);
        ctx.textAlign = 'left';
        ctx.fillText('L', cx - maxRadius - 8, cy + 3);
        ctx.textAlign = 'right';
        ctx.fillText('R', cx + maxRadius + 8, cy + 3);

        // Listener icon (small circle at center)
        ctx.fillStyle = '#666';
        ctx.beginPath();
        ctx.arc(cx, cy, 3, 0, Math.PI * 2);
        ctx.fill();

        // Source position
        const rad = ((azimuth - 90) * Math.PI) / 180;
        const sx = cx + Math.cos(rad) * maxRadius * distance;
        const sy = cy + Math.sin(rad) * maxRadius * distance;

        // Line from center to source
        ctx.strokeStyle = `${color}60`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(sx, sy);
        ctx.stroke();

        // Source dot
        ctx.fillStyle = color;
        ctx.shadowColor = color;
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(sx, sy, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        // Readout
        ctx.fillStyle = '#888';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(`${azimuth.toFixed(0)}° ${(distance * 100).toFixed(0)}%`, cx, size - 2);
    }, [azimuth, distance, size, color, cx, cy, maxRadius]);

    const handlePointer = (e: React.MouseEvent<HTMLCanvasElement>): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = e.clientX - rect.left - cx;
        const my = e.clientY - rect.top - cy;

        const newDist = Math.min(1, Math.sqrt(mx * mx + my * my) / maxRadius);
        const newAz = ((Math.atan2(my, mx) * 180) / Math.PI + 90 + 360) % 360;
        const normalizedAz = newAz > 180 ? newAz - 360 : newAz;

        setAzimuth(Math.round(normalizedAz));
        setDistance(Math.round(newDist * 100) / 100);
        onChange?.(normalizedAz, newDist);
    };

    return (
        <canvas
            ref={canvasRef}
            width={size}
            height={size}
            className="rounded border border-border/30 cursor-crosshair"
            aria-label={`Spatial panner: ${azimuth}° azimuth, ${(distance * 100).toFixed(0)}% distance`}
            role="slider"
            onMouseDown={(e) => {
                dragging.current = true;
                handlePointer(e);
            }}
            onMouseMove={(e) => {
                if (dragging.current) {
                    handlePointer(e);
                }
            }}
            onMouseUp={() => {
                dragging.current = false;
            }}
            onMouseLeave={() => {
                dragging.current = false;
            }}
        />
    );
};
