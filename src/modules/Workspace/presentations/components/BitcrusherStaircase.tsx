/**
 * BitcrusherStaircase — Canvas2D quantization staircase visualization.
 *
 * Draws a sine wave quantized to the specified bit depth,
 * showing the staircase effect of bit reduction and sample rate decimation.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type BitcrusherStaircaseProps = {
    bits: number;        // 1–16
    rateReduction: number; // 1–40
    mix: number;         // 0–1
    width?: number;
    height?: number;
};

const quantize = (value: number, bits: number): number => {
    const levels = Math.pow(2, bits);
    const step = 2 / levels; // range is -1 to 1
    return Math.round(value / step) * step;
};

export const BitcrusherStaircase = ({
    bits,
    rateReduction,
    mix,
    width = 200,
    height = 80,
}: BitcrusherStaircaseProps): ReactElement => {
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

        // Background
        const bg = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.fillStyle = bg;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        const pad = 4;
        const gw = width - pad * 2;
        const gh = height - pad * 2;
        const centerY = pad + gh / 2;

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(pad, centerY);
        ctx.lineTo(pad + gw, centerY);
        ctx.stroke();

        // Original sine (ghost)
        ctx.beginPath();
        for (let i = 0; i <= gw; i++) {
            const t = i / gw;
            const val = Math.sin(t * Math.PI * 4); // 2 cycles
            const y = centerY - val * (gh / 2 - 2);
            if (i === 0) ctx.moveTo(pad + i, y);
            else ctx.lineTo(pad + i, y);
        }
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.stroke();

        // Crushed waveform
        const accentLavender = resolveToken('--color-accent-lavender', '#b8a0d0');
        const sampleStep = Math.max(1, Math.round(rateReduction));
        let lastVal = 0;

        ctx.beginPath();
        for (let i = 0; i <= gw; i++) {
            const t = i / gw;
            const originalVal = Math.sin(t * Math.PI * 4);

            // Sample & hold at reduced rate
            if (i % sampleStep === 0) {
                lastVal = quantize(originalVal, bits);
            }

            // Blend with mix
            const blended = originalVal * (1 - mix) + lastVal * mix;
            const y = centerY - blended * (gh / 2 - 2);
            if (i === 0) ctx.moveTo(pad + i, y);
            else ctx.lineTo(pad + i, y);
        }
        ctx.strokeStyle = accentLavender;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Bit depth label
        ctx.fillStyle = accentLavender;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(bits)}-bit`, width - pad - 2, pad + 10);

        // Rate label
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '7px monospace';
        ctx.fillText(`${sampleStep}× ↓`, width - pad - 2, height - pad - 1);
    }, [bits, rateReduction, mix, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label={`Bitcrusher: ${Math.round(bits)}-bit quantization`}
            role="img"
        />
    );
};
