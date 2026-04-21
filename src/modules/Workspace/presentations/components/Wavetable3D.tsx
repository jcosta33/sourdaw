/**
 * Wavetable 3D Display component.
 * Canvas2D 3D-like perspective rendering of wavetable frames.
 * Shows multiple waveform cycles stacked in depth.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

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
    for (let freq = 0; freq < frameCount; freq++) {
        const frame = new Float32Array(samplesPerFrame);
        const morph = freq / (frameCount - 1);
        for (let index = 0; index < samplesPerFrame; index++) {
            const time = (index / samplesPerFrame) * Math.PI * 2;
            frame[index] = Math.sin(time) * (1 - morph) + ((time % (Math.PI * 2)) / Math.PI - 1) * morph;
        }
        frames.push(frame);
    }
    return frames;
}

export const Wavetable3D = ({
    frames: inputFrames,
    width = 200,
    height = 150,
    color = resolveToken('--color-palette-steel', '#4a7090'),
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
        ctx.fillStyle = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.fillRect(0, 0, width, height);

        const frameCount = frames.length;
        const depthStep = (height * 0.5) / frameCount;
        const xShift = (width * 0.15) / frameCount;

        for (let freq = frameCount - 1; freq >= 0; freq--) {
            const frame = frames[freq]!;
            const yBase = height * 0.7 - freq * depthStep;
            const xOffset = freq * xShift;
            const alpha = 0.3 + 0.7 * (freq / frameCount);
            const waveWidth = width * 0.7;

            ctx.beginPath();
            for (let index = 0; index < frame.length; index++) {
                const x = xOffset + (index / frame.length) * waveWidth;
                const y = yBase - frame[index]! * depthStep * 2;
                if (index === 0) {
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
        ctx.fillStyle = resolveToken('--color-text-tertiary', '#666');
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
