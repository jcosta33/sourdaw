/**
 * Canvas-based waveform display with mipmap-driven rendering.
 * Renders min/max pairs as a filled waveform with an optional playback cursor.
 */

import { type ReactElement, useEffect, useRef } from 'react';

type WaveformDisplayProps = {
    instanceId: string;
    peaks: number[];
    totalFrames: number;
    onPositionSubscribe: (instanceId: string, callback: (pos: number) => void) => () => void;
    color?: string;
    backgroundColor?: string;
    cursorColor?: string;
    height?: number;
    className?: string;
};

export const WaveformDisplay = ({
    instanceId,
    peaks,
    totalFrames,
    onPositionSubscribe,
    color = '#60C8E0',
    backgroundColor = 'transparent',
    cursorColor = 'rgba(255, 200, 100, 0.85)',
    height = 120,
    className = '',
}: WaveformDisplayProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const cursorRef = useRef<HTMLDivElement>(null);

    // Repaint on data/styling change AND on container resize. The canvas is fluid
    // (w-full), so a window/panel resize changes its measured width; observing it
    // here redraws against the new width instead of leaving the last bitmap
    // stretched. ResizeObserver fires once synchronously on observe(), so this
    // also covers the initial paint without a separate effect.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return undefined;
        }

        const draw = (): void => {
            if (peaks.length === 0) {
                return;
            }

            const ctx = canvas.getContext('2d');
            if (!ctx) {
                return;
            }

            const dpr = window.devicePixelRatio || 1;
            const rect = canvas.getBoundingClientRect();
            canvas.width = rect.width * dpr;
            canvas.height = rect.height * dpr;
            ctx.scale(dpr, dpr);

            const w = rect.width;
            const h = rect.height;
            const mid = h / 2;

            ctx.fillStyle = backgroundColor;
            ctx.fillRect(0, 0, w, h);

            // peaks is flattened [min0, max0, min1, max1, ...]
            const numBins = Math.floor(peaks.length / 2);
            if (numBins === 0) {
                return;
            }

            const binWidth = w / numBins;

            ctx.fillStyle = color;
            ctx.globalAlpha = 0.85;

            for (let i = 0; i < numBins; i++) {
                const min = peaks[i * 2] ?? 0;
                const max = peaks[i * 2 + 1] ?? 0;

                const x = i * binWidth;
                const yTop = mid - max * mid;
                const yBot = mid - min * mid;
                const barHeight = Math.max(1, yBot - yTop);

                ctx.fillRect(x, yTop, Math.max(1, binWidth - 0.5), barHeight);
            }

            ctx.globalAlpha = 1;
        };

        if (typeof ResizeObserver === 'undefined') {
            draw();
            return undefined;
        }

        const observer = new ResizeObserver(() => {
            draw();
        });
        observer.observe(canvas);
        return () => {
            observer.disconnect();
        };
    }, [peaks, color, backgroundColor]);

    // Update cursor position directly via DOM mutation to avoid React re-renders.
    useEffect(() => {
        return onPositionSubscribe(instanceId, (playbackFrame) => {
            const cursor = cursorRef.current;
            const canvas = canvasRef.current;
            if (!cursor || !canvas || totalFrames <= 0) {
                return;
            }

            const rect = canvas.getBoundingClientRect();
            const normalizedPos = Math.min(playbackFrame / totalFrames, 1);
            cursor.style.left = `${normalizedPos * rect.width}px`;
            cursor.style.display = playbackFrame > 0 ? 'block' : 'none';
        });
    }, [instanceId, totalFrames, onPositionSubscribe]);

    return (
        <div className="relative">
            <canvas ref={canvasRef} className={`w-full ${className}`} style={{ height }} />
            <div
                ref={cursorRef}
                className="pointer-events-none absolute top-0"
                style={{
                    width: 1,
                    height,
                    backgroundColor: cursorColor,
                    display: 'none',
                }}
            />
        </div>
    );
};
