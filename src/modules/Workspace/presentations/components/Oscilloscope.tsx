/**
 * Oscilloscope component.
 * Real-time waveform display on a Canvas2D surface.
 * Can display master or per-track audio.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';
import { resolveToken } from '#/helpers/UI/resolveToken';

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
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        let rafId = 0;

        const draw = (): void => {
            const analyser = trackId
                ? (audioEngine.getTrackStrip(trackId)?.analyserNode ?? audioEngine.masterAnalyser)
                : audioEngine.masterAnalyser;

            const bufferLength = analyser.frequencyBinCount;
            const data = new Float32Array(bufferLength);
            analyser.getFloatTimeDomainData(data);

            // Clear
            ctx.fillStyle = '#0a0a0a';
            ctx.fillRect(0, 0, width, height);

            // Grid lines
            ctx.strokeStyle = '#1a1a1a';
            ctx.lineWidth = 0.5;
            const midY = height / 2;

            // Horizontal center line
            ctx.beginPath();
            ctx.moveTo(0, midY);
            ctx.lineTo(width, midY);
            ctx.stroke();

            // Quarter lines
            ctx.strokeStyle = '#141414';
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

            // Draw waveform
            ctx.strokeStyle = color;
            ctx.lineWidth = 1.5;
            ctx.beginPath();

            const sliceWidth = width / bufferLength;
            let x = 0;

            for (let i = 0; i < bufferLength; i++) {
                const sample = data[i]!;
                const y = midY - sample * midY * 0.9; // Scale to 90% of half-height

                if (i === 0) {
                    ctx.moveTo(x, y);
                } else {
                    ctx.lineTo(x, y);
                }
                x += sliceWidth;
            }

            ctx.stroke();

            // Glow effect
            ctx.strokeStyle = `${color}40`;
            ctx.lineWidth = 4;
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
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-border/30"
            aria-label="Oscilloscope"
        />
    );
};
