/**
 * StepSequencerEditor — step-based modulation sequencer.
 *
 * Visual grid editor for defining step patterns used as modulation sources.
 * Supports variable step counts (1-32) and value drawing.
 */
import { type ReactElement, useRef, useEffect, useState } from 'react';

type StepSequencerEditorProps = {
    width: number;
    height: number;
    steps: number[];
    numSteps: number;
    onStepsChange: (steps: number[]) => void;
};

export const StepSequencerEditor = ({
    width,
    height,
    steps: initialSteps,
    numSteps,
    onStepsChange,
}: StepSequencerEditorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const resolveSteps = (): number[] =>
        initialSteps.length >= numSteps ? initialSteps : Array.from({ length: numSteps }, () => 0);

    // Content signature of the controlled props. Step values are quantized
    // numbers (never NaN/object), so a join is a faithful content key.
    const controlledSignature = `${numSteps}:${initialSteps.join(',')}`;

    const [steps, setSteps] = useState<number[]>(resolveSteps);
    // Re-sync local edits to the controlled props only when their *content*
    // changes. The live mount passes a fresh `steps={[]}` literal on every
    // parent render, so a prior effect keyed on the array identity re-fired
    // each render and clobbered in-progress edits. Tracking the last-synced
    // content signature and adjusting state during render (React's recommended
    // "reset state on prop change" pattern) re-syncs on real content changes
    // only, with no dependency on the unstable array reference.
    const lastSignatureRef = useRef(controlledSignature);
    if (lastSignatureRef.current !== controlledSignature) {
        lastSignatureRef.current = controlledSignature;
        setSteps(resolveSteps());
    }

    const drawingRef = useRef(false);

    const draw = (): void => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, width, height);

        // Background
        ctx.fillStyle = '#0a0a0a';
        ctx.fillRect(0, 0, width, height);

        const stepWidth = width / numSteps;
        const halfHeight = height / 2;

        // Center line
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, halfHeight);
        ctx.lineTo(width, halfHeight);
        ctx.stroke();

        // Beat markers
        for (let i = 0; i < numSteps; i++) {
            if (i % 4 === 0) {
                ctx.strokeStyle = 'rgba(255,255,255,0.08)';
                ctx.beginPath();
                ctx.moveTo(i * stepWidth, 0);
                ctx.lineTo(i * stepWidth, height);
                ctx.stroke();
            }
        }

        // Draw steps
        for (let i = 0; i < numSteps; i++) {
            const val = steps[i] ?? 0;
            const x = i * stepWidth;

            // Bar from center
            const barHeight = Math.abs(val) * halfHeight;
            const barY = val >= 0 ? halfHeight - barHeight : halfHeight;

            const alpha = 0.4 + Math.abs(val) * 0.6;
            ctx.fillStyle = val >= 0 ? `rgba(244, 63, 94, ${alpha})` : `rgba(96, 165, 250, ${alpha})`;
            ctx.fillRect(x + 1, barY, stepWidth - 2, barHeight);

            // Border
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.strokeRect(x, 0, stepWidth, height);
        }
    };

    // §150.2 — Only redraw when step content or size changes.
    useEffect(() => {
        draw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [steps, numSteps, width, height]);

    const updateStepFromPointer = (e: React.PointerEvent): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        const stepWidth = width / numSteps;
        const stepIdx = Math.floor(cx / stepWidth);
        if (stepIdx < 0 || stepIdx >= numSteps) {
            return;
        }

        // Value: top = 1, center = 0, bottom = -1
        const val = Math.max(-1, Math.min(1, 1 - (cy / height) * 2));

        const newSteps = [...steps];
        newSteps[stepIdx] = Math.round(val * 20) / 20; // Quantize slightly
        setSteps(newSteps);
    };

    const handlePointerDown = (e: React.PointerEvent): void => {
        drawingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateStepFromPointer(e);
    };

    const handlePointerMove = (e: React.PointerEvent): void => {
        if (!drawingRef.current) {
            return;
        }
        updateStepFromPointer(e);
    };

    const handlePointerUp = (): void => {
        if (drawingRef.current) {
            drawingRef.current = false;
            onStepsChange(steps);
        }
    };

    const handlePointerCancel = (): void => {
        drawingRef.current = false;
    };

    return (
        <div className="relative">
            <canvas
                ref={canvasRef}
                width={width}
                height={height}
                className="rounded-lg border border-border/30 cursor-crosshair"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerCancel}
            />
            <span className="absolute top-1 left-1 text-nano text-muted-foreground/30 font-mono">
                Step Sequencer ({numSteps} steps)
            </span>
        </div>
    );
};
