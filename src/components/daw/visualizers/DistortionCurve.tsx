/**
 * DistortionCurve — Canvas2D waveshaper transfer function visualization.
 *
 * Draws the input->output transfer curve for a waveshaper distortion,
 * showing how the drive parameter clips the signal. Higher drive = more
 * aggressive S-curve. Uses 45 degree unity line as reference.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { resolveToken } from '#/utils/UI/resolveToken';

type DistortionCurveProps = {
    drive: number; // 0–100
    tone: number; // 200–8000 Hz (for display label only)
    mix: number; // 0–1
    width?: number;
    height?: number;
    onParamChange?: (paramId: string, value: number) => void;
};

/** Attempt to match the waveshaper curve used in deviceNodeFactory */
const waveshape = (x: number, drive: number): number => {
    const k = drive * 4; // amplify the effect
    if (k === 0) {
        return x;
    }
    return Math.tanh(x * k) / Math.tanh(k);
};

export const DistortionCurve = ({
    drive,
    tone: _tone,
    mix,
    width = 200,
    height = 120,
    onParamChange,
}: DistortionCurveProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const isDragging = useRef(false);
    const lastY = useRef(0);
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

        const pad = 8;
        const gw = width - pad * 2;
        const gh = height - pad * 2;

        // Grid: unity line (45°)
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 0.5;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(pad, pad + gh);
        ctx.lineTo(pad + gw, pad);
        ctx.stroke();
        ctx.setLineDash([]);

        // Grid: center cross — subtle dotted
        ctx.strokeStyle = 'rgba(255,255,255,0.04)';
        ctx.setLineDash([1, 4]);
        ctx.beginPath();
        ctx.moveTo(pad + gw / 2, pad);
        ctx.lineTo(pad + gw / 2, pad + gh);
        ctx.moveTo(pad, pad + gh / 2);
        ctx.lineTo(pad + gw, pad + gh / 2);
        ctx.stroke();
        ctx.setLineDash([]);

        // Compute transfer curve
        const accPeach = resolveToken('--color-accent-peach', '#f0944c');
        const normalizedDrive = drive / 100; // 0–1
        const points: [number, number][] = [];
        const steps = gw;

        for (let i = 0; i <= steps; i++) {
            const inputNorm = i / steps; // 0–1
            const input = inputNorm * 2 - 1; // -1 to +1
            const shaped = waveshape(input, normalizedDrive);
            // Blend with dry based on mix
            const blended = input * (1 - mix) + shaped * mix;
            const outputNorm = (blended + 1) / 2; // back to 0–1
            const x = pad + i;
            const y = pad + gh - outputNorm * gh;
            points.push([x, y]);
        }

        // Fill under curve — gradient
        ctx.beginPath();
        ctx.moveTo(pad, pad + gh);
        for (const [x, y] of points) {
            ctx.lineTo(x, y);
        }
        ctx.lineTo(pad + gw, pad + gh);
        ctx.closePath();
        const distFillGrad = ctx.createLinearGradient(0, pad, 0, pad + gh);
        distFillGrad.addColorStop(0, `${accPeach}22`);
        distFillGrad.addColorStop(1, `${accPeach}04`);
        ctx.fillStyle = distFillGrad;
        ctx.fill();

        // Glow pass
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = `${accPeach}28`;
        ctx.lineWidth = 5;
        ctx.stroke();

        // Sharp stroke
        ctx.beginPath();
        for (let i = 0; i < points.length; i++) {
            const [x, y] = points[i]!;
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.strokeStyle = accPeach;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Labels — very dim
        ctx.fillStyle = '#383838';
        ctx.font = '7px monospace';
        ctx.textAlign = 'left';
        ctx.fillText('IN', pad, pad + gh + 9);
        ctx.textAlign = 'right';
        ctx.fillText('OUT', pad + gw, pad - 2);

        // "drag to adjust" hint
        if (isInteractive && !isDragging.current) {
            ctx.fillStyle = 'rgba(255,255,255,0.25)';
            ctx.font = '7px monospace';
            ctx.textAlign = 'center';
            ctx.fillText('drag to adjust', width / 2, pad + 10);
        }
    }, [drive, mix, width, height, _tone, isInteractive]);

    const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        isDragging.current = true;
        lastY.current = e.clientY;
        canvas.setPointerCapture(e.pointerId);
        canvas.style.cursor = 'grabbing';
    };

    const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange || !isDragging.current) {
            return;
        }
        const deltaY = lastY.current - e.clientY; // up = positive
        lastY.current = e.clientY;
        // Map vertical drag to drive change: ~0.5 drive units per pixel
        const sensitivity = 0.5;
        const newDrive = Math.max(0, Math.min(100, drive + deltaY * sensitivity));
        onParamChange('dist-drive', newDrive);
    };

    const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
        if (!onParamChange) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        isDragging.current = false;
        canvas.releasePointerCapture(e.pointerId);
        canvas.style.cursor = 'grab';
    };

    return (
        <canvas
            ref={canvasRef}
            style={{ width, height, cursor: isInteractive ? 'grab' : undefined }}
            className="rounded border border-border/30"
            aria-label="Distortion transfer curve"
            role="img"
            onPointerDown={isInteractive ? handlePointerDown : undefined}
            onPointerMove={isInteractive ? handlePointerMove : undefined}
            onPointerUp={isInteractive ? handlePointerUp : undefined}
        />
    );
};
