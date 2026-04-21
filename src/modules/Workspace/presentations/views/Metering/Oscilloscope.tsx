/**
 * Oscilloscope component.
 * Real-time waveform display on a Canvas2D surface.
 * Can display master or per-track audio.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { DawMeterFrame } from '#/components/daw/DawMeterFrame';
import { getMasterAnalyser, getTrackAnalyser } from '#/modules/AudioEngine/useCases';
import { resolveToken } from '#/utils/UI/resolveToken';

type OscilloscopeProps = {
    trackId?: string;
    width?: number;
    height?: number;
    color?: string;
};

export const Oscilloscope = ({
    trackId,
    width = 200,
    height = 80,
    color = resolveToken('--color-meter-safe', '#4a9960'),
}: OscilloscopeProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return () => {};
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return () => {};
        }

        let rafId = 0;
        // Reused across frames — reallocated only if frequencyBinCount changes.
        let data: Float32Array<ArrayBuffer> | null = null;

        // Pre-generate noise texture once into an offscreen canvas.
        const noiseCanvas = document.createElement('canvas');
        noiseCanvas.width = width;
        noiseCanvas.height = height;
        const noiseCtx = noiseCanvas.getContext('2d');
        if (noiseCtx) {
            noiseCtx.globalAlpha = 0.025;
            for (let nx = 0; nx < width; nx += 3) {
                for (let ny = 0; ny < height; ny += 3) {
                    const v = Math.random() * 255;
                    noiseCtx.fillStyle = `rgb(${v},${v},${v})`;
                    noiseCtx.fillRect(nx, ny, 2, 2);
                }
            }
        }

        const draw = (): void => {
            const analyser = trackId ? (getTrackAnalyser(trackId) ?? getMasterAnalyser()) : getMasterAnalyser();

            const bufferLength = analyser.frequencyBinCount;
            if (!data || data.length !== bufferLength) {
                data = new Float32Array(bufferLength);
            }
            analyser.getFloatTimeDomainData(data);

            // Background — deep black with subtle noise texture
            ctx.fillStyle = '#050508';
            ctx.fillRect(0, 0, width, height);
            // Cached noise overlay
            ctx.drawImage(noiseCanvas, 0, 0);

            // Grid lines — subtle dashed
            ctx.setLineDash([2, 4]);
            ctx.strokeStyle = 'rgba(255,255,255,0.04)';
            ctx.lineWidth = 0.5;
            const midY = height / 2;

            // Horizontal center line (slightly brighter)
            ctx.strokeStyle = 'rgba(255,255,255,0.07)';
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(width, midY);
            ctx.stroke();

            // Quarter lines
            ctx.strokeStyle = 'rgba(255,255,255,0.03)';
            ctx.beginPath();
            ctx.moveTo(0, midY / 2);
            ctx.lineTo(width, midY / 2);
            ctx.moveTo(0, midY + midY / 2);
            ctx.lineTo(width, midY + midY / 2);
            ctx.stroke();

            // Vertical grid
            for (let x = 0; x < width; x += width / 8) {
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
            }
            ctx.setLineDash([]);

            // Draw waveform — glow pass first (wider, semi-transparent with shadow)
            const sliceWidth = width / bufferLength;
            let x = 0;

            ctx.beginPath();
            for (let i = 0; i < bufferLength; i++) {
                const sample = data[i]!;
                const y = midY - sample * midY * 0.9;
                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }
            ctx.strokeStyle = `${color}25`;
            ctx.lineWidth = 6;
            ctx.shadowColor = color;
            ctx.shadowBlur = 12;
            ctx.stroke();
            ctx.shadowBlur = 0;

            // Draw waveform — sharp pass on top
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const sample = data[i]!;
                const y = midY - sample * midY * 0.9;

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }

            ctx.stroke();

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, width, height, color]);

    return (
        <DawMeterFrame>
            <canvas ref={canvasRef} width={width} height={height} className="block" aria-label="Oscilloscope" />
        </DawMeterFrame>
    );
};
