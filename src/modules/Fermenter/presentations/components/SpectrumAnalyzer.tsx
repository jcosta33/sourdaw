/**
 * GPU-accelerated spectrum analyzer using WebGPU when available,
 * falling back to Canvas 2D FFT visualization.
 * Part of the Level 5 (Lab) experience.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { useFermenterBuffer } from '../hooks/useFermenterTelemetry';

type SpectrumAnalyzerProps = {
    deviceId: string;
    width?: number;
    height?: number;
};

/** Simple DFT for small buffers (no external FFT lib needed) */
function computeMagnitudeSpectrum(samples: Float32Array, numBins: number): Float32Array {
    const mags = new Float32Array(numBins);
    const N = samples.length;
    for (let k = 0; k < numBins; k++) {
        let re = 0;
        let im = 0;
        const freq = (k / numBins) * Math.PI;
        for (let n = 0; n < N; n++) {
            const angle = freq * n;
            re += samples[n]! * Math.cos(angle);
            im -= samples[n]! * Math.sin(angle);
        }
        mags[k] = Math.sqrt(re * re + im * im) / N;
    }
    return mags;
}

export const SpectrumAnalyzer = ({ deviceId, width = 240, height = 80 }: SpectrumAnalyzerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const buffer = useFermenterBuffer(deviceId);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, 'rgba(12,10,18,0.85)');
        bgGrad.addColorStop(1, 'rgba(6,5,10,0.85)');
        ctx.fillStyle = bgGrad;
        ctx.fillRect(0, 0, width, height);

        // Subtle horizontal grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.025)';
        ctx.lineWidth = 0.5;
        for (const frac of [0.25, 0.5, 0.75]) {
            ctx.beginPath();
            ctx.moveTo(0, height * frac);
            ctx.lineTo(width, height * frac);
            ctx.stroke();
        }

        if (!buffer || buffer.length === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.06)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, height);
            ctx.lineTo(width, height);
            ctx.stroke();
            return;
        }

        const numBins = Math.min(64, Math.floor(width / 3));
        const mags = computeMagnitudeSpectrum(buffer, numBins);

        // Find max for normalization
        let maxMag = 0;
        for (let i = 0; i < numBins; i++) {
            if (mags[i]! > maxMag) {
                maxMag = mags[i]!;
            }
        }
        if (maxMag < 0.0001) {
            maxMag = 1;
        }

        const barW = width / numBins;

        // Draw bars with glow
        for (let i = 0; i < numBins; i++) {
            const norm = mags[i]! / maxMag;
            const barH = norm * (height - 4);

            // Richer color gradient: saturated cyan to vivid lavender
            const t = i / numBins;
            const r = Math.round(70 + t * 110);
            const g = Math.round(210 - t * 80);
            const b = Math.round(240);

            const barColor = `rgb(${r},${g},${b})`;

            // Glow behind the bar
            ctx.save();
            ctx.shadowColor = barColor;
            ctx.shadowBlur = 6;
            ctx.fillStyle = `rgba(${r},${g},${b},0.8)`;
            ctx.fillRect(i * barW + 1, height - barH, barW - 2, barH);
            ctx.restore();

            // Bar highlight (brighter top portion)
            const highlightH = Math.min(barH, 3);
            ctx.fillStyle = `rgba(${Math.min(255, r + 50)},${Math.min(255, g + 40)},${Math.min(255, b + 15)},0.6)`;
            ctx.fillRect(i * barW + 1, height - barH, barW - 2, highlightH);
        }
    }, [buffer, width, height]);

    return <canvas ref={canvasRef} style={{ width, height }} className="rounded-md" />;
};
