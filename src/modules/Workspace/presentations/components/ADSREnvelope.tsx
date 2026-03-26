/**
 * ADSR Envelope — Canvas2D amplitude envelope visualization.
 *
 * Draws the attack/decay/sustain/release shape with interactive
 * breakpoints and a filled gradient area. Updates in real-time
 * as knob values change.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { resolveToken } from '#/helpers/UI/resolveToken';

type ADSREnvelopeProps = {
    attack: number;   // seconds (0–2)
    decay: number;    // seconds (0–2)
    sustain: number;  // level (0–1)
    release: number;  // seconds (0–3)
    /** Accent color token or hex */
    color?: string;
    width?: number;
    height?: number;
};

export const ADSREnvelope = ({
    attack,
    decay,
    sustain,
    release,
    color,
    width = 200,
    height = 80,
}: ADSREnvelopeProps): ReactElement => {
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

        const pad = 6;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = resolveToken('--color-bg-tray', '#0a0a0a');
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        // Normalize time segments to fit the plot width
        const totalTime = Math.max(0.01, attack + decay + 0.4 + release); // 0.4 = sustain hold
        const sustainHold = 0.4;
        const aX = pad + (attack / totalTime) * plotW;
        const dX = aX + (decay / totalTime) * plotW;
        const sX = dX + (sustainHold / totalTime) * plotW;
        const rX = sX + (release / totalTime) * plotW;

        const topY = pad + 2;
        const bottomY = pad + plotH;
        const sustainY = bottomY - sustain * (plotH - 4);

        const accent = color ?? resolveToken('--color-accent-teal', '#4CB8B8');

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        for (let i = 0; i <= 4; i++) {
            const y = pad + (plotH / 4) * i;
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(width - pad, y);
            ctx.stroke();
        }

        // Envelope fill
        ctx.beginPath();
        ctx.moveTo(pad, bottomY);
        ctx.lineTo(aX, topY);          // Attack
        ctx.lineTo(dX, sustainY);      // Decay
        ctx.lineTo(sX, sustainY);      // Sustain hold
        ctx.lineTo(rX, bottomY);       // Release
        ctx.lineTo(pad, bottomY);
        ctx.closePath();

        const gradient = ctx.createLinearGradient(0, topY, 0, bottomY);
        gradient.addColorStop(0, `${accent}25`);
        gradient.addColorStop(1, `${accent}05`);
        ctx.fillStyle = gradient;
        ctx.fill();

        // Envelope line
        ctx.beginPath();
        ctx.moveTo(pad, bottomY);
        ctx.lineTo(aX, topY);
        ctx.lineTo(dX, sustainY);
        ctx.lineTo(sX, sustainY);
        ctx.lineTo(rX, bottomY);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Breakpoint dots
        const dots = [
            { x: pad, y: bottomY },
            { x: aX, y: topY },
            { x: dX, y: sustainY },
            { x: sX, y: sustainY },
            { x: rX, y: bottomY },
        ];
        for (const dot of dots) {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, 1.5, 0, Math.PI * 2);
            ctx.fillStyle = '#000';
            ctx.fill();
        }

        // Phase labels
        ctx.fillStyle = resolveToken('--color-text-disabled', '#3a3a3a');
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';

        const labelY = height - 1;
        ctx.fillText('A', (pad + aX) / 2, labelY);
        ctx.fillText('D', (aX + dX) / 2, labelY);
        ctx.fillText('S', (dX + sX) / 2, labelY);
        ctx.fillText('R', (sX + rX) / 2, labelY);

        // Sustain level label
        ctx.fillStyle = `${accent}80`;
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${(sustain * 100).toFixed(0)}%`, width - pad, sustainY - 4);
    }, [attack, decay, sustain, release, color, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label="ADSR envelope shape"
            role="img"
        />
    );
};
