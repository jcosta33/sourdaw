/**
 * Reverb Decay Visualization — Canvas2D impulse decay envelope.
 *
 * Draws a stylized impulse response envelope showing the approximate
 * decay character based on size, decay time, damping, and predelay.
 * Uses lavender accent (Time & Space category color) for consistency.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type ReverbDecayProps = {
    size: number; // 0–1, room size factor
    decay: number; // seconds, RT60
    damping: number; // 0–1, high-frequency damping
    predelay: number; // ms
    width?: number;
    height?: number;
};

export const ReverbDecay = ({
    size,
    decay,
    damping,
    predelay,
    width = 200,
    height = 60,
}: ReverbDecayProps): ReactElement => {
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

        const dpr = window.devicePixelRatio || 1;
        canvas.width = width * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, width, height);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0e0e12');
        bgGrad.addColorStop(1, '#060608');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        // Grid — subtle dotted
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 4]);
        for (let i = 1; i < 4; i++) {
            const y = (i / 4) * height;
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        const accentLavender = resolveToken('--color-accent-lavender', '#c488f0');
        const pad = 4;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;

        // Normalize predelay to plot space (max display ~500ms context)
        const maxTimeMs = Math.max(decay * 1000 * 1.2, 500);
        const predelayFrac = Math.min(predelay / maxTimeMs, 0.3);

        // Build envelope
        const steps = plotW;
        ctx.beginPath();
        ctx.moveTo(pad, pad + plotH); // bottom-left

        for (let i = 0; i <= steps; i++) {
            const tFrac = i / steps;
            const x = pad + i;
            let amp: number;

            if (tFrac < predelayFrac) {
                // Before predelay — silence
                amp = 0;
            } else if (tFrac < predelayFrac + 0.02) {
                // Initial transient — fast rise modulated by size
                const attackFrac = (tFrac - predelayFrac) / 0.02;
                amp = attackFrac * (0.6 + size * 0.4);
            } else {
                // Decay envelope — exponential with damping modulation
                const decayStart = predelayFrac + 0.02;
                const decayFrac = (tFrac - decayStart) / (1 - decayStart);
                // Decay constant based on RT60
                const tau = decay / 6.9; // seconds to time constant
                const normalizedDecay = (tau * 1000) / maxTimeMs;
                const expDecay = Math.exp(-decayFrac / Math.max(normalizedDecay, 0.01));
                // Damping reduces high reflections (faster initial drop)
                const dampFactor = 1 - damping * 0.3;
                // Add diffusion ripple based on size
                const ripple = 1 + Math.sin(decayFrac * (30 + size * 50)) * 0.08 * expDecay;
                amp = (0.6 + size * 0.4) * expDecay * dampFactor * ripple;
            }

            const y = pad + plotH - amp * plotH;
            ctx.lineTo(x, Math.max(pad, y));
        }

        // Close path for fill
        ctx.lineTo(pad + plotW, pad + plotH);
        ctx.closePath();

        // Gradient fill — more visible
        const grad = ctx.createLinearGradient(0, pad, 0, pad + plotH);
        grad.addColorStop(0, `${accentLavender}38`);
        grad.addColorStop(1, `${accentLavender}06`);
        ctx.fillStyle = grad;
        ctx.fill();

        // Stroke outline — glow pass
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const tFrac = i / steps;
            const x = pad + i;
            let amp: number;

            if (tFrac < predelayFrac) {
                amp = 0;
            } else if (tFrac < predelayFrac + 0.02) {
                const attackFrac = (tFrac - predelayFrac) / 0.02;
                amp = attackFrac * (0.6 + size * 0.4);
            } else {
                const decayStart = predelayFrac + 0.02;
                const decayFrac = (tFrac - decayStart) / (1 - decayStart);
                const tau = decay / 6.9;
                const normalizedDecay = (tau * 1000) / maxTimeMs;
                const expDecay = Math.exp(-decayFrac / Math.max(normalizedDecay, 0.01));
                const dampFactor = 1 - damping * 0.3;
                const ripple = 1 + Math.sin(decayFrac * (30 + size * 50)) * 0.08 * expDecay;
                amp = (0.6 + size * 0.4) * expDecay * dampFactor * ripple;
            }

            const y = pad + plotH - amp * plotH;
            if (i === 0) {
                ctx.moveTo(x, Math.max(pad, y));
            } else {
                ctx.lineTo(x, Math.max(pad, y));
            }
        }
        ctx.strokeStyle = `${accentLavender}28`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Stroke outline — sharp pass
        ctx.beginPath();
        for (let i = 0; i <= steps; i++) {
            const tFrac = i / steps;
            const x = pad + i;
            let amp: number;

            if (tFrac < predelayFrac) {
                amp = 0;
            } else if (tFrac < predelayFrac + 0.02) {
                const attackFrac = (tFrac - predelayFrac) / 0.02;
                amp = attackFrac * (0.6 + size * 0.4);
            } else {
                const decayStart = predelayFrac + 0.02;
                const decayFrac = (tFrac - decayStart) / (1 - decayStart);
                const tau = decay / 6.9;
                const normalizedDecay = (tau * 1000) / maxTimeMs;
                const expDecay = Math.exp(-decayFrac / Math.max(normalizedDecay, 0.01));
                const dampFactor = 1 - damping * 0.3;
                const ripple = 1 + Math.sin(decayFrac * (30 + size * 50)) * 0.08 * expDecay;
                amp = (0.6 + size * 0.4) * expDecay * dampFactor * ripple;
            }

            const y = pad + plotH - amp * plotH;
            if (i === 0) {
                ctx.moveTo(x, Math.max(pad, y));
            } else {
                ctx.lineTo(x, Math.max(pad, y));
            }
        }
        ctx.strokeStyle = accentLavender;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Predelay marker
        if (predelay > 1) {
            const pdX = pad + predelayFrac * plotW;
            ctx.beginPath();
            ctx.setLineDash([2, 2]);
            ctx.moveTo(pdX, pad);
            ctx.lineTo(pdX, pad + plotH);
            ctx.strokeStyle = `${accentLavender}50`;
            ctx.lineWidth = 0.75;
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = `${accentLavender}80`;
            ctx.font = '7px monospace';
            ctx.textAlign = 'left';
            ctx.fillText(`${Math.round(predelay)}ms`, pdX + 2, pad + 8);
        }

        // Decay label — very dim
        ctx.fillStyle = '#383838';
        ctx.font = '7px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${decay.toFixed(1)}s`, width - pad, height - 2);
    }, [size, decay, damping, predelay, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label="Reverb decay envelope"
            role="img"
        />
    );
};
