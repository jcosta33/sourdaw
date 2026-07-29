/**
 * FilterResponse — Interactive frequency response visualization.
 *
 * Draws the frequency response of LP/HP/BP/Notch filters.
 * Drag the cutoff dot horizontally to change frequency,
 * vertically to change resonance.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type FilterResponseProps = {
    cutoff: number; // Hz (20–20000)
    resonance: number; // Q (0–20)
    filterType: number; // 0=LP, 1=HP, 2=BP, 3=Notch
    width?: number;
    height?: number;
    /** Called when user drags the cutoff dot */
    onParamChange?: (paramId: string, value: number) => void;
};

const MIN_FREQ = 20;
const MAX_FREQ = 20000;
const DB_RANGE = 30;

type FilterTypeLabel = 'LP' | 'HP' | 'BP' | 'Notch';
const FILTER_LABELS: FilterTypeLabel[] = ['LP', 'HP', 'BP', 'Notch'];

const filterMag = (freq: number, fc: number, Q: number, type: number): number => {
    const width = freq / fc;
    const w2 = width * width;
    const inv = 1 / Q;

    switch (type) {
        case 0: {
            const den = Math.sqrt((1 - w2) ** 2 + (width * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001));
        }
        case 1: {
            const den = Math.sqrt((1 - w2) ** 2 + (width * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001)) + 20 * Math.log10(Math.max(w2, 0.0001));
        }
        case 2: {
            const den = Math.sqrt((1 - w2) ** 2 + (width * inv) ** 2);
            return -20 * Math.log10(Math.max(den, 0.0001)) + 20 * Math.log10(Math.max(width * inv, 0.0001));
        }
        case 3: {
            const num = Math.sqrt((1 - w2) ** 2);
            const den = Math.sqrt((1 - w2) ** 2 + (width * inv) ** 2);
            return 20 * Math.log10(Math.max(num / den, 0.0001));
        }
        default:
            return 0;
    }
};

const freqToX = (freq: number, width: number): number =>
    (Math.log10(freq / MIN_FREQ) / Math.log10(MAX_FREQ / MIN_FREQ)) * width;

const xToFreq = (xPos: number, width: number): number => MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (xPos / width);

export const FilterResponse = ({
    cutoff,
    resonance,
    filterType,
    width = 200,
    height = 80,
    onParamChange,
}: FilterResponseProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);
    const isInteractive = !!onParamChange;

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

        const zeroY = height * 0.6;

        // Grid — subtle dotted
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        ctx.lineTo(width, zeroY);
        ctx.stroke();

        for (const freq of [100, 1000, 10000]) {
            const xPos = freqToX(freq, width);
            ctx.beginPath();
            ctx.moveTo(xPos, 0);
            ctx.lineTo(xPos, height);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Cutoff vertical marker
        const cutoffX = freqToX(cutoff, width);
        ctx.strokeStyle = 'rgba(255,255,255,0.12)';
        ctx.setLineDash([2, 2]);
        ctx.beginPath();
        ctx.moveTo(cutoffX, 0);
        ctx.lineTo(cutoffX, height);
        ctx.stroke();
        ctx.setLineDash([]);

        // Compute curve
        const accentCyan = resolveToken('--color-accent-cyan', '#50d0e8');
        const type = Math.round(filterType);
        const points: [number, number][] = [];

        for (let index = 0; index <= width; index++) {
            const freq = MIN_FREQ * (MAX_FREQ / MIN_FREQ) ** (index / width);
            const db = filterMag(freq, cutoff, resonance, type);
            const clamped = Math.max(-DB_RANGE, Math.min(DB_RANGE, db));
            const yPos = zeroY - (clamped / DB_RANGE) * zeroY;
            points.push([index, yPos]);
        }

        // Fill gradient
        ctx.beginPath();
        ctx.moveTo(0, zeroY);
        for (const [xPos, yPos] of points) {
            ctx.lineTo(xPos, yPos);
        }
        ctx.lineTo(width, zeroY);
        ctx.closePath();
        const fillGrad = ctx.createLinearGradient(0, 0, 0, height);
        fillGrad.addColorStop(0, `${accentCyan}28`);
        fillGrad.addColorStop(1, `${accentCyan}04`);
        ctx.fillStyle = fillGrad;
        ctx.fill();

        // Glow pass
        ctx.beginPath();
        for (let index = 0; index < points.length; index++) {
            const [xPos, yPos] = points[index]!;
            if (index === 0) {
                ctx.moveTo(xPos, yPos);
            } else {
                ctx.lineTo(xPos, yPos);
            }
        }
        ctx.strokeStyle = `${accentCyan}30`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Sharp stroke
        ctx.beginPath();
        for (let index = 0; index < points.length; index++) {
            const [xPos, yPos] = points[index]!;
            if (index === 0) {
                ctx.moveTo(xPos, yPos);
            } else {
                ctx.lineTo(xPos, yPos);
            }
        }
        ctx.strokeStyle = accentCyan;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Cutoff dot — larger if interactive
        const cutoffDb = filterMag(cutoff, cutoff, resonance, type);
        const dotY = zeroY - (Math.max(-DB_RANGE, Math.min(DB_RANGE, cutoffDb)) / DB_RANGE) * zeroY;
        const dotR = isInteractive ? 5 : 3;
        ctx.beginPath();
        ctx.arc(cutoffX, dotY, dotR, 0, Math.PI * 2);
        ctx.fillStyle = accentCyan;
        ctx.fill();
        if (isInteractive) {
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Labels — very dim
        ctx.fillStyle = '#383838';
        ctx.font = '7px monospace';
        ctx.textAlign = 'center';
        for (const [label, freq] of [
            ['100', 100],
            ['1k', 1000],
            ['10k', 10000],
        ] as const) {
            ctx.fillText(label, freqToX(freq, width), height - 2);
        }

        // Filter type badge
        const typeLabel = FILTER_LABELS[type] ?? 'LP';
        ctx.fillStyle = accentCyan;
        ctx.font = 'bold 8px monospace';
        ctx.textAlign = 'right';
        ctx.fillText(typeLabel, width - 4, 10);

        // Interaction hint
        if (isInteractive) {
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.font = '7px system-ui';
            ctx.textAlign = 'left';
            ctx.fillText('drag to adjust', 4, 10);
        }
    }, [cutoff, resonance, filterType, width, height, isInteractive]);

    const handlePointerDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        isDragging.current = true;
        canvas.setPointerCapture(event.pointerId);
        canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
        if (!isDragging.current || !onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const xPos = event.clientX - rect.left;
        const yPos = event.clientY - rect.top;

        // Horizontal → frequency (log scale)
        const freq = Math.max(MIN_FREQ, Math.min(MAX_FREQ, xToFreq(xPos, width)));
        onParamChange('filterCutoff', Math.round(freq));

        // Vertical → resonance (inverted: top = high Q).
        //
        // This spans `builtin-synth:filterResonance`'s declared range, 0 to 20.
        // It is a second, independently-authored copy of that range — this is a
        // shared `src/components/` component and cannot read a descriptor — so
        // it is the drift risk, not the source of truth. It previously bottomed
        // out at 0.1 and so could not express `factory-bass-sub`'s shipped
        // `filterResonance: 0`; dragging anywhere on the pad silently raised it.
        const normalizedY = 1 - Math.max(0, Math.min(1, yPos / height));
        const query = normalizedY * 20; // 0 to 20
        onParamChange('filterResonance', Math.round(query * 10) / 10);
    };

    const handlePointerUp = (event: React.PointerEvent<HTMLCanvasElement>) => {
        isDragging.current = false;
        const canvas = canvasRef.current;
        if (canvas) {
            canvas.releasePointerCapture(event.pointerId);
            canvas.style.cursor = isInteractive ? 'grab' : 'default';
        }
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : 'default' }}
            className="rounded border border-border/30"
            aria-label="Filter frequency response — drag to adjust cutoff and resonance"
            role="img"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
        />
    );
};
