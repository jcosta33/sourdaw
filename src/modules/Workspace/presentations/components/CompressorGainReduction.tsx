/**
 * Compressor Gain Reduction Meter component.
 * Real-time display of gain reduction on a Canvas2D vertical bar.
 * Typically placed on compressor/limiter device views.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { audioEngine } from '#/modules/AudioEngine/repositories/audioEngineInstance';

type CompressorGainReductionProps = {
    trackId?: string;
    height?: number;
    width?: number;
    threshold?: number; // threshold in dB, default -12
    ratio?: number; // compression ratio, default 4:1
};

export const CompressorGainReduction = ({
    trackId,
    height = 100,
    width = 28,
    threshold = -12,
    ratio = 4,
}: CompressorGainReductionProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const smoothedRef = useRef(0);

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

            const data = new Float32Array(analyser.frequencyBinCount);
            analyser.getFloatTimeDomainData(data);

            // Compute peak level
            let peak = 0;
            for (let i = 0; i < data.length; i++) {
                const abs = Math.abs(data[i]!);
                if (abs > peak) {
                    peak = abs;
                }
            }

            // Convert to dB
            const peakDb = peak > 0 ? 20 * Math.log10(peak) : -60;

            // Simulate gain reduction based on threshold and ratio
            let gainReductionDb = 0;
            if (peakDb > threshold) {
                const excess = peakDb - threshold;
                gainReductionDb = excess * (1 - 1 / ratio);
            }

            // Smooth the GR display
            const smoothing = 0.85;
            smoothedRef.current = smoothing * smoothedRef.current + (1 - smoothing) * gainReductionDb;
            const gr = smoothedRef.current;

            // Draw
            ctx.clearRect(0, 0, width, height);

            // Background
            ctx.fillStyle = '#0a0a0a';
            ctx.beginPath();
            ctx.roundRect(0, 0, width, height, 3);
            ctx.fill();

            // GR bar (grows downward from top)
            const maxGR = 24; // Max displayed GR in dB
            const barH = Math.min(1, gr / maxGR) * (height - 8);

            // Gradient for GR: amber at top, red at bottom
            if (barH > 0) {
                const grad = ctx.createLinearGradient(0, 4, 0, 4 + barH);
                grad.addColorStop(0, '#eab308');
                grad.addColorStop(1, gr > 12 ? '#ef4444' : '#f59e0b');
                ctx.fillStyle = grad;
                ctx.fillRect(4, 4, width - 8, barH);
            }

            // Scale marks
            ctx.fillStyle = '#444';
            ctx.font = '7px monospace';
            ctx.textAlign = 'right';
            for (const db of [0, -6, -12, -18, -24]) {
                const y = 4 + (Math.abs(db) / maxGR) * (height - 8);
                ctx.fillRect(2, y, width - 4, 0.5);
                ctx.fillText(`${db}`, width - 2, y - 1);
            }

            // GR readout
            ctx.fillStyle = gr > 6 ? '#ef4444' : '#eab308';
            ctx.font = '8px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(gr > 0.1 ? `-${gr.toFixed(1)}` : '0.0', width / 2, height - 2);

            rafId = requestAnimationFrame(draw);
        };

        draw();
        return () => cancelAnimationFrame(rafId);
    }, [trackId, height, width, threshold, ratio]);

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className="rounded border border-border/30"
            aria-label={`Gain reduction meter`}
            role="meter"
            aria-valuemin={0}
            aria-valuemax={24}
        />
    );
};
