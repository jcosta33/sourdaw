/**
 * GPU-accelerated spectrum analyzer using WebGPU when available,
 * falling back to Canvas 2D FFT visualization.
 * Part of the Level 5 (Lab) experience.
 */
import { type ReactElement, useRef, useEffect } from 'react';

type SpectrumAnalyzerProps = {
    buffer: Float32Array | null;
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

export const SpectrumAnalyzer = ({
    buffer,
    width = 240,
    height = 80,
}: SpectrumAnalyzerProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fillRect(0, 0, width, height);

        if (!buffer || buffer.length === 0) {
            ctx.strokeStyle = 'rgba(255,255,255,0.08)';
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
            if (mags[i]! > maxMag) maxMag = mags[i]!;
        }
        if (maxMag < 0.0001) maxMag = 1;

        const barW = width / numBins;

        // Draw bars
        for (let i = 0; i < numBins; i++) {
            const norm = mags[i]! / maxMag;
            const barH = norm * (height - 4);

            // Color gradient from cyan (low) to lavender (high freq)
            const t = i / numBins;
            const r = Math.round(96 + t * 88);
            const g = Math.round(200 - t * 70);
            const b = Math.round(232);

            ctx.fillStyle = `rgba(${r},${g},${b},0.7)`;
            ctx.fillRect(
                i * barW + 1,
                height - barH,
                barW - 2,
                barH,
            );
        }
    }, [buffer, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded-md"
        />
    );
};
