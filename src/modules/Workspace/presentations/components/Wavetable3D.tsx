/**
 * Wavetable 3D Display component.
 * Canvas2D 3D-like perspective rendering of wavetable frames.
 * Shows multiple waveform cycles stacked in depth.
 */
import { type ReactElement, useRef, useEffect } from 'react';

type Wavetable3DProps = {
    /** Wavetable data: array of waveform frames (each frame is Float32Array of samples) */
    frames?: Float32Array[];
    width?: number;
    height?: number;
    color?: string;
};

function generateDefaultFrames(): Float32Array[] {
    const frameCount = 16;
    const samplesPerFrame = 128;
    const frames: Float32Array[] = [];
    for (let f = 0; f < frameCount; f++) {
        const frame = new Float32Array(samplesPerFrame);
        const morph = f / (frameCount - 1);
        for (let i = 0; i < samplesPerFrame; i++) {
            const t = (i / samplesPerFrame) * Math.PI * 2;
            frame[i] = Math.sin(t) * (1 - morph) + ((t % (Math.PI * 2)) / Math.PI - 1) * morph;
        }
        frames.push(frame);
    }
    return frames;
}

export const Wavetable3D = ({
    frames: inputFrames,
    width = 200,
    height = 150,
    color = '#4a7090',
}: Wavetable3DProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const frames = inputFrames ?? generateDefaultFrames();

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
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const frameCount = frames.length;
        const depthStep = (height * 0.5) / frameCount;
        const xShift = (width * 0.15) / frameCount;

        for (let f = frameCount - 1; f >= 0; f--) {
            const frame = frames[f]!;
            const yBase = height * 0.7 - f * depthStep;
            const xOffset = f * xShift;
            const alpha = 0.3 + 0.7 * (f / frameCount);
            const waveWidth = width * 0.7;

            ctx.beginPath();
            for (let i = 0; i < frame.length; i++) {
                const x = xOffset + (i / frame.length) * waveWidth;
                const y = yBase - frame[i]! * depthStep * 2;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
            }
            ctx.strokeStyle = `${color}${Math.round(alpha * 255)
                .toString(16)
                .padStart(2, '0')}`;
            ctx.lineWidth = 1;
            ctx.stroke();

            // Fill below for depth
            ctx.lineTo(xOffset + waveWidth, yBase + depthStep);
            ctx.lineTo(xOffset, yBase + depthStep);
            ctx.closePath();
            ctx.fillStyle = `${color}${Math.round(alpha * 40)
                .toString(16)
                .padStart(2, '0')}`;
            ctx.fill();
        }

        // Labels
        ctx.fillStyle = '#666';
        ctx.font = '8px monospace';
        ctx.fillText(`${frameCount} frames`, 4, height - 4);
    }, [frames, width, height, color]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-border/30"
            aria-label="Wavetable 3D display"
            role="img"
        />
    );
};
