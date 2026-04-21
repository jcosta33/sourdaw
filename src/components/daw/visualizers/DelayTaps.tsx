/**
 * Delay Tap Visualization — Canvas2D tap pattern display.
 *
 * Shows the delay feedback pattern as descending echo taps.
 * Each tap is a vertical bar whose height represents amplitude,
 * spaced by the delay time and decaying by the feedback amount.
 * Uses cyan accent (routing/secondary) for consistency.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type DelayTapsProps = {
    time: number; // ms, delay time
    feedback: number; // 0–0.95, feedback amount
    mix: number; // 0–1, dry/wet
    width?: number;
    height?: number;
    onParamChange?: (paramId: string, value: number) => void;
};

type DragTarget = 'time' | 'feedback';

export const DelayTaps = ({
    time,
    feedback,
    mix,
    width = 200,
    height = 50,
    onParamChange,
}: DelayTapsProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);
    const dragTarget = useRef<DragTarget | null>(null);
    const isInteractive = !!onParamChange;

    // Store positions for hit testing
    const firstTapXRef = useRef(0);
    const envelopeYRef = useRef(0);

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

        const accentCyan = resolveToken('--color-accent-cyan', '#50d0e8');
        const pad = 6;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;

        // How many taps can we show?
        const maxTaps = Math.min(12, Math.max(2, Math.floor(2000 / time)));
        const totalDuration = time * maxTaps;
        const barWidth = Math.max(2, Math.min(8, (plotW / maxTaps) * 0.4));

        // Draw baseline — subtle dotted
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        ctx.moveTo(pad, pad + plotH);
        ctx.lineTo(pad + plotW, pad + plotH);
        ctx.stroke();
        ctx.setLineDash([]);

        // Dry signal bar
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        const dryBarH = plotH * 0.9;
        ctx.fillRect(pad, pad + plotH - dryBarH, barWidth, dryBarH);

        // "D" label for dry
        ctx.fillStyle = '#383838';
        ctx.font = '6px monospace';
        ctx.textAlign = 'center';
        ctx.fillText('D', pad + barWidth / 2, pad + plotH - dryBarH - 2);

        // Store first tap position for hit testing
        const firstTapTime = time * 1;
        firstTapXRef.current = pad + (firstTapTime / totalDuration) * plotW;
        const firstTapAmplitude = mix * feedback ** 1;
        envelopeYRef.current = pad + plotH - firstTapAmplitude * plotH;

        // Delay taps
        for (let tap = 1; tap <= maxTaps; tap++) {
            const amplitude = mix * feedback ** tap;
            if (amplitude < 0.01) {
                break;
            }

            const tapTime = time * tap;
            const xPos = pad + (tapTime / totalDuration) * plotW;
            const barH = amplitude * plotH;

            // Gradient per tap: brighter at top
            const grad = ctx.createLinearGradient(0, pad + plotH - barH, 0, pad + plotH);
            grad.addColorStop(
                0,
                `${accentCyan}${Math.round(amplitude * 200)
                    .toString(16)
                    .padStart(2, '0')}`
            );
            grad.addColorStop(1, `${accentCyan}10`);
            ctx.fillStyle = grad;
            ctx.fillRect(xPos - barWidth / 2, pad + plotH - barH, barWidth, barH);

            // Top highlight
            ctx.fillStyle = `${accentCyan}${Math.round(amplitude * 180)
                .toString(16)
                .padStart(2, '0')}`;
            ctx.fillRect(xPos - barWidth / 2, pad + plotH - barH, barWidth, 1);
        }

        // Connecting decay envelope line — glow
        ctx.beginPath();
        ctx.moveTo(pad + barWidth, pad + plotH - mix * plotH);
        for (let tap = 1; tap <= maxTaps; tap++) {
            const amplitude = mix * feedback ** tap;
            if (amplitude < 0.01) {
                break;
            }
            const tapTime = time * tap;
            const xPos = pad + (tapTime / totalDuration) * plotW;
            const yPos = pad + plotH - amplitude * plotH;
            ctx.lineTo(xPos, yPos);
        }
        ctx.strokeStyle = `${accentCyan}20`;
        ctx.lineWidth = 4;
        ctx.stroke();

        // Connecting decay envelope line — sharp
        ctx.beginPath();
        ctx.moveTo(pad + barWidth, pad + plotH - mix * plotH);
        for (let tap = 1; tap <= maxTaps; tap++) {
            const amplitude = mix * feedback ** tap;
            if (amplitude < 0.01) {
                break;
            }
            const tapTime = time * tap;
            const xPos = pad + (tapTime / totalDuration) * plotW;
            const yPos = pad + plotH - amplitude * plotH;
            ctx.lineTo(xPos, yPos);
        }
        ctx.strokeStyle = `${accentCyan}50`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 2]);
        ctx.stroke();
        ctx.setLineDash([]);

        // Time label — very dim
        ctx.fillStyle = '#383838';
        ctx.font = '7px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(time)}ms`, width - pad, height - 2);

        // "drag to adjust" hint
        if (isInteractive && !isDragging.current) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '7px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('drag to adjust', width / 2, pad + 8);
        }
    }, [time, feedback, mix, width, height, isInteractive]);

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;

        // Determine drag target: near first tap X = time, near envelope line = feedback
        const distToTap = Math.abs(mx - firstTapXRef.current);
        const distToEnvelope = Math.abs(my - envelopeYRef.current);

        // Prefer horizontal (time) if closer to the first tap, vertical (feedback) if closer to envelope
        if (distToTap < 20) {
            dragTarget.current = 'time';
        } else if (distToEnvelope < 20) {
            dragTarget.current = 'feedback';
        } else {
            // Default: pick whichever is closer
            dragTarget.current = distToTap < distToEnvelope ? 'time' : 'feedback';
        }

        isDragging.current = true;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange || !isDragging.current || !dragTarget.current) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const pad = 6;
        const plotW = width - pad * 2;
        const plotH = height - pad * 2;

        if (dragTarget.current === 'time') {
            // Map horizontal position to delay time (1-2000ms)
            const mx = event.clientX - rect.left;
            const xRatio = Math.max(0, Math.min(1, (mx - pad) / plotW));
            const newTime = 1 + xRatio * (2000 - 1);
            onParamChange('delay-time', newTime);
        } else {
            // Map vertical position to feedback (0-0.95)
            const my = event.clientY - rect.top;
            const bottomY = pad + plotH;
            const topY = pad;
            const yRatio = 1 - (my - topY) / (bottomY - topY);
            const newFeedback = Math.max(0, Math.min(0.95, yRatio));
            onParamChange('delay-feedback', newFeedback);
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        isDragging.current = false;
        dragTarget.current = null;
        canvas.releasePointerCapture(event.pointerId);
        canvas.style.cursor = 'grab';
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : undefined }}
            className="rounded border border-border/30"
            aria-label="Delay tap pattern"
            role="img"
            onPointerDown={isInteractive ? handlePointerDown : undefined}
            onPointerMove={isInteractive ? handlePointerMove : undefined}
            onPointerUp={isInteractive ? handlePointerUp : undefined}
        />
    );
};
