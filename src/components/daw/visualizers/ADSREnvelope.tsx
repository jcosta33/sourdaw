/**
 * ADSR Envelope — Canvas2D amplitude envelope visualization.
 *
 * Draws the attack/decay/sustain/release shape with interactive
 * breakpoints and a filled gradient area. Updates in real-time
 * as knob values change.
 */
import { type ReactElement, useRef, useEffect, useLayoutEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type ADSREnvelopeProps = {
    attack: number; // seconds (0–2)
    decay: number; // seconds (0–2)
    sustain: number; // level (0–1)
    release: number; // seconds (0–3)
    /** Accent color token or hex */
    color?: string;
    width?: number;
    height?: number;
    onParamChange?: (paramId: string, value: number) => void;
    onGestureStart?: (paramId: BreakpointId) => boolean;
    onGestureCommit?: (paramId: BreakpointId, value: number) => void;
    onGestureCancel?: (paramId: BreakpointId) => void;
};

type BreakpointId = 'attack' | 'decay' | 'sustain' | 'release';

type ReleaseDragGeometry = {
    startClientX: number;
    startValue: number;
    secondsPerPixel: number;
};

type EnvelopeGesture = {
    pointerId: number;
    canvas: HTMLCanvasElement;
    breakpoint: BreakpointId;
    releaseDrag?: ReleaseDragGeometry;
    lastValue?: number;
    change: NonNullable<ADSREnvelopeProps['onParamChange']>;
    commit: ADSREnvelopeProps['onGestureCommit'];
    cancel: ADSREnvelopeProps['onGestureCancel'];
};

function createReleaseDragGeometry(
    startClientX: number,
    startValue: number,
    attack: number,
    decay: number,
    width: number
): ReleaseDragGeometry | null {
    const plotWidth = width - 12;
    const totalTime = Math.max(0.01, attack + decay + 0.4 + startValue);
    const secondsPerPixel = totalTime / plotWidth;
    if (
        !Number.isFinite(startClientX) ||
        !Number.isFinite(startValue) ||
        !Number.isFinite(plotWidth) ||
        plotWidth <= 0 ||
        !Number.isFinite(secondsPerPixel) ||
        secondsPerPixel <= 0
    ) {
        return null;
    }
    return { startClientX, startValue, secondsPerPixel };
}

function finishGesture(gestureRef: { current: EnvelopeGesture | null }, commit: boolean): void {
    const gesture = gestureRef.current;
    if (!gesture) {
        return;
    }
    // Releasing capture can synchronously report its loss. Retire first.
    gestureRef.current = null;
    const { canvas, pointerId, breakpoint } = gesture;
    if (!canvas.hasPointerCapture || canvas.hasPointerCapture(pointerId)) {
        canvas.releasePointerCapture(pointerId);
    }
    canvas.style.cursor = 'grab';
    if (commit && gesture.lastValue !== undefined && gesture.commit) {
        gesture.commit(breakpoint, gesture.lastValue);
    } else {
        gesture.cancel?.(breakpoint);
    }
}

export const ADSREnvelope = ({
    attack,
    decay,
    sustain,
    release,
    color,
    width = 200,
    height = 80,
    onParamChange,
    onGestureStart,
    onGestureCommit,
    onGestureCancel,
}: ADSREnvelopeProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const gestureRef = useRef<EnvelopeGesture | null>(null);
    const isInteractive = !!onParamChange;

    // Store computed breakpoint positions for hit testing
    const breakpointsRef = useRef<{ id: BreakpointId; x: number; y: number }[]>([]);

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

        const rawColor = color ?? resolveToken('--color-accent-teal', '#4CB8B8');
        // Resolve CSS variable references (e.g. 'var(--color-accent-mint)') to hex for canvas
        const accent = rawColor.startsWith('var(') ? resolveToken(rawColor.slice(4, -1), '#4CB8B8') : rawColor;

        // Store breakpoint positions for hit testing
        breakpointsRef.current = [
            { id: 'attack', x: aX, y: topY },
            { id: 'decay', x: dX, y: sustainY },
            { id: 'sustain', x: sX, y: sustainY },
            { id: 'release', x: rX, y: bottomY },
        ];

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 0.5;
        for (let index = 0; index <= 4; index++) {
            const y = pad + (plotH / 4) * index;
            ctx.beginPath();
            ctx.moveTo(pad, y);
            ctx.lineTo(width - pad, y);
            ctx.stroke();
        }

        // Envelope fill
        ctx.beginPath();
        ctx.moveTo(pad, bottomY);
        ctx.lineTo(aX, topY); // Attack
        ctx.lineTo(dX, sustainY); // Decay
        ctx.lineTo(sX, sustainY); // Sustain hold
        ctx.lineTo(rX, bottomY); // Release
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
        const dotRadius = isInteractive ? 6 : 3;
        const innerRadius = isInteractive ? 3 : 1.5;
        for (const dot of dots) {
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, dotRadius, 0, Math.PI * 2);
            ctx.fillStyle = accent;
            ctx.fill();
            if (isInteractive) {
                ctx.strokeStyle = '#ffffff';
                ctx.lineWidth = 1;
                ctx.stroke();
            }
            ctx.beginPath();
            ctx.arc(dot.x, dot.y, innerRadius, 0, Math.PI * 2);
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

        // "drag to adjust" hint
        if (isInteractive && !gestureRef.current) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '7px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('drag to adjust', width / 2, pad + 10);
        }
    }, [attack, decay, sustain, release, color, width, height, isInteractive]);

    useLayoutEffect(() => {
        const cancel = (): void => finishGesture(gestureRef, false);
        const visibilityChanged = (): void => {
            if (document.visibilityState === 'hidden') {
                cancel();
            }
        };
        window.addEventListener('blur', cancel);
        document.addEventListener('visibilitychange', visibilityChanged);
        return () => {
            window.removeEventListener('blur', cancel);
            document.removeEventListener('visibilitychange', visibilityChanged);
            cancel();
        };
    }, []);

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange || gestureRef.current || event.button !== 0) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;

        // Find closest breakpoint within hit radius
        const hitRadius = 16;
        let closest: BreakpointId | null = null;
        let closestDist = Infinity;
        for (const bp of breakpointsRef.current) {
            const dx = mx - bp.x;
            const dy = my - bp.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < hitRadius && dist < closestDist) {
                closestDist = dist;
                closest = bp.id;
            }
        }

        if (!closest) {
            return;
        }
        const releaseDrag =
            closest === 'release' ? createReleaseDragGeometry(event.clientX, release, attack, decay, width) : undefined;
        if (releaseDrag === null) {
            return;
        }
        if (onGestureStart && !onGestureStart(closest)) {
            return;
        }
        gestureRef.current = {
            pointerId: event.pointerId,
            canvas,
            breakpoint: closest,
            releaseDrag,
            change: onParamChange,
            commit: onGestureCommit,
            cancel: onGestureCancel,
        };
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) {
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
        const mx = event.clientX - rect.left;
        const my = event.clientY - rect.top;
        if (!Number.isFinite(mx) || !Number.isFinite(my) || plotW <= 0 || plotH <= 2) {
            finishGesture(gestureRef, false);
            return;
        }
        const change = (id: BreakpointId, value: number): void => {
            gesture.lastValue = value;
            gesture.change(id, value);
        };
        const bp = gesture.breakpoint;

        if (bp === 'sustain') {
            // Vertical drag only -> sustain level (0-1)
            const bottomY = pad + plotH;
            const topY = pad + 2;
            const ratio = 1 - (my - topY) / (bottomY - topY);
            const clamped = Math.max(0, Math.min(1, ratio));
            change('sustain', clamped);
        } else if (bp === 'release') {
            const releaseDrag = gesture.releaseDrag;
            if (!releaseDrag) {
                finishGesture(gestureRef, false);
                return;
            }
            const value =
                releaseDrag.startValue + (event.clientX - releaseDrag.startClientX) * releaseDrag.secondsPerPixel;
            change('release', Math.max(0.001, Math.min(5, value)));
        } else {
            // Horizontal drag -> time parameter
            const xRatio = Math.max(0, Math.min(1, (mx - pad) / plotW));
            const totalTime = Math.max(0.01, attack + decay + 0.4 + release);
            const mappedTime = xRatio * totalTime;

            if (bp === 'attack') {
                const val = Math.max(0.001, Math.min(2, mappedTime));
                change('attack', val);
            } else if (bp === 'decay') {
                const val = Math.max(0.001, Math.min(2, mappedTime - attack));
                change('decay', Math.max(0.001, val));
            }
        }
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (gestureRef.current?.pointerId !== event.pointerId) {
            return;
        }
        finishGesture(gestureRef, true);
    };

    const handlePointerCancel = (event: React.PointerEvent<HTMLCanvasElement>): void => {
        if (gestureRef.current?.pointerId === event.pointerId) {
            finishGesture(gestureRef, false);
        }
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : undefined }}
            className="rounded border border-border/30"
            aria-label="ADSR envelope shape"
            role="img"
            onPointerDown={isInteractive ? handlePointerDown : undefined}
            onPointerMove={isInteractive ? handlePointerMove : undefined}
            onPointerUp={isInteractive ? handlePointerUp : undefined}
            onPointerCancel={isInteractive ? handlePointerCancel : undefined}
            onLostPointerCapture={isInteractive ? handlePointerCancel : undefined}
        />
    );
};
