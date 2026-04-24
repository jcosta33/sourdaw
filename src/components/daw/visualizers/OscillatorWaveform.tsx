/**
 * Oscillator Waveform Preview — Canvas2D waveform shape display.
 *
 * Renders the selected oscillator waveform shape (sine, triangle,
 * sawtooth, square) with optional osc2 overlay showing detune/mix.
 * Updates in real-time as waveform selection changes.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type OscillatorWaveformProps = {
    waveform: 'sine' | 'triangle' | 'sawtooth' | 'square';
    /** Optional second oscillator waveform for overlay */
    osc2Waveform?: 'sine' | 'triangle' | 'sawtooth' | 'square';
    /** Second oscillator mix (0–1). If 0 or undefined, no overlay shown */
    osc2Mix?: number;
    /** Detune in cents */
    detune?: number;
    width?: number;
    height?: number;
};

/** Generate one cycle of a waveform at normalized position (0–1) → amplitude (-1 to 1) */
function waveformSample(type: string, time: number): number {
    const phase = time % 1;
    switch (type) {
        case 'sine':
            return Math.sin(phase * Math.PI * 2);
        case 'triangle':
            return 4 * Math.abs(phase - 0.5) - 1;
        case 'sawtooth':
            return 2 * phase - 1;
        case 'square':
            return phase < 0.5 ? 1 : -1;
        default:
            return Math.sin(phase * Math.PI * 2);
    }
}

export const OscillatorWaveform = ({
    waveform,
    osc2Waveform,
    osc2Mix = 0,
    detune = 0,
    width = 200,
    height = 60,
}: OscillatorWaveformProps): ReactElement => {
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

        const pad = 6;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;

        ctx.clearRect(0, 0, width, height);

        // Background — deep gradient
        const bgGrad = ctx.createLinearGradient(0, 0, 0, height);
        bgGrad.addColorStop(0, '#0e0e12');
        bgGrad.addColorStop(1, '#060608');
        ctx.fillStyle = bgGrad;
        ctx.beginPath();
        ctx.roundRect(0, 0, width, height, 4);
        ctx.fill();

        // Center line — subtle dotted
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        ctx.moveTo(pad, height / 2);
        ctx.lineTo(width - pad, height / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        const accent = resolveToken('--color-accent-blue', '#58b8e8');
        const accent2 = resolveToken('--color-accent-purple', '#b060e0');
        const cycles = 2.5;

        // Detune ratio for osc2 (slight frequency offset)
        const detuneRatio = 2 ** (detune / 1200);

        // Draw osc2 first (behind) if mix > 0
        if (osc2Mix > 0 && osc2Waveform) {
            ctx.beginPath();
            for (let index = 0; index <= plotW; index++) {
                const time = (index / plotW) * cycles * detuneRatio;
                const sample = waveformSample(osc2Waveform, time);
                const xPos = pad + index;
                const yPos = height / 2 - sample * (plotH / 2) * 0.85;
                if (index === 0) {
                    ctx.moveTo(xPos, yPos);
                } else {
                    ctx.lineTo(xPos, yPos);
                }
            }
            ctx.strokeStyle = `${accent2}${Math.round(osc2Mix * 180)
                .toString(16)
                .padStart(2, '0')}`;
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        // Draw osc1 (main waveform) — glow pass
        ctx.beginPath();
        for (let index = 0; index <= plotW; index++) {
            const time = (index / plotW) * cycles;
            const sample = waveformSample(waveform, time);
            const xPos = pad + index;
            const yPos = height / 2 - sample * (plotH / 2) * 0.85;
            if (index === 0) {
                ctx.moveTo(xPos, yPos);
            } else {
                ctx.lineTo(xPos, yPos);
            }
        }
        ctx.strokeStyle = `${accent}30`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Draw osc1 (main waveform) — sharp stroke
        ctx.beginPath();
        for (let index = 0; index <= plotW; index++) {
            const time = (index / plotW) * cycles;
            const sample = waveformSample(waveform, time);
            const xPos = pad + index;
            const yPos = height / 2 - sample * (plotH / 2) * 0.85;
            if (index === 0) {
                ctx.moveTo(xPos, yPos);
            } else {
                ctx.lineTo(xPos, yPos);
            }
        }
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Fill under osc1 — gradient
        ctx.lineTo(width - pad, height / 2);
        ctx.lineTo(pad, height / 2);
        ctx.closePath();
        const osc1Fill = ctx.createLinearGradient(0, 0, 0, height);
        osc1Fill.addColorStop(0, `${accent}22`);
        osc1Fill.addColorStop(1, `${accent}04`);
        ctx.fillStyle = osc1Fill;
        ctx.fill();

        // Waveform label
        ctx.fillStyle = `${accent}90`;
        ctx.font = '8px monospace';
        ctx.textAlign = 'right';
        const label = waveform.charAt(0).toUpperCase() + waveform.slice(1, 3).toUpperCase();
        ctx.fillText(label, width - pad, pad + 8);

        if (osc2Mix > 0 && osc2Waveform) {
            ctx.fillStyle = `${accent2}90`;
            ctx.fillText(`+${(osc2Mix * 100).toFixed(0)}%`, width - pad, pad + 18);
        }
    }, [waveform, osc2Waveform, osc2Mix, detune, width, height]);

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height }}
            className="rounded border border-border/30"
            aria-label={`${waveform} oscillator waveform`}
            role="img"
        />
    );
};
