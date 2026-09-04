/**
 * SpectralBinEditor — bin-level spectral gate/blur editor.
 *
 * Visual editor for controlling spectral processing at the FFT bin level.
 * Users can draw threshold curves and blur amounts per frequency band.
 */
import { type ReactElement, useRef, useEffect, useState } from 'react';

type SpectralBinEditorProps = {
    width: number;
    height: number;
    numBins?: number;
    binValues: number[]; // 0-1 per bin (gate threshold or blur amount)
    onBinValuesChange: (values: number[]) => void;
    mode: 'gate' | 'blur';
};

export const SpectralBinEditor = ({
    width,
    height,
    numBins = 64,
    binValues: initialValues,
    onBinValuesChange,
    mode,
}: SpectralBinEditorProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    const resolveValues = (): number[] =>
        initialValues.length === numBins ? initialValues : Array.from({ length: numBins }, () => 0.5);

    // Content signature of the controlled props. Bin values are quantized
    // numbers (never NaN/object), so a join is a faithful content key.
    const controlledSignature = `${numBins}:${initialValues.join(',')}`;

    const [values, setValues] = useState<number[]>(resolveValues);
    // Re-sync local edits to the controlled props only when their *content*
    // changes. The live mount passes a fresh `binValues={[]}` literal on every
    // parent render, so a re-sync keyed on the array identity would re-fire each
    // render and clobber in-progress edits. Tracking the last-synced content
    // signature and adjusting state during render (React's recommended "reset
    // state on prop change" pattern) re-syncs on real content changes only,
    // with no dependency on the unstable array reference.
    const lastSignatureRef = useRef(controlledSignature);
    if (lastSignatureRef.current !== controlledSignature) {
        lastSignatureRef.current = controlledSignature;
        setValues(resolveValues());
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

        // Frequency labels (log scale)
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.font = '7px monospace';
        const freqLabels = [100, 500, 1000, 5000, 10000];
        for (const freq of freqLabels) {
            const logPos = Math.log10(freq / 20) / Math.log10(20000 / 20);
            const x = logPos * width;
            ctx.fillText(freq >= 1000 ? `${freq / 1000}k` : `${freq}`, x, height - 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.03)';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height - 10);
            ctx.stroke();
        }

        // Draw bins
        const binWidth = width / numBins;
        for (let i = 0; i < numBins; i++) {
            const val = values[i] ?? 0.5;
            const barHeight = val * (height - 12);
            const x = i * binWidth;

            // Color based on mode and value
            if (mode === 'gate') {
                const alpha = 0.3 + val * 0.7;
                ctx.fillStyle = `rgba(244, 63, 94, ${alpha})`;
            } else {
                const alpha = 0.2 + val * 0.6;
                ctx.fillStyle = `rgba(96, 165, 250, ${alpha})`;
            }

            ctx.fillRect(x, height - 12 - barHeight, binWidth - 1, barHeight);
        }

        // Draw value curve on top
        ctx.strokeStyle = mode === 'gate' ? 'rgb(244, 63, 94)' : 'rgb(96, 165, 250)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        for (let i = 0; i < numBins; i++) {
            const x = (i + 0.5) * binWidth;
            const y = height - 12 - (values[i] ?? 0.5) * (height - 12);
            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }
        ctx.stroke();
    };

    // §150.2 — only redraw when bin content / layout / mode changes.
    useEffect(() => {
        draw();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [values, numBins, width, height, mode]);

    const updateBinsFromPointer = (e: React.PointerEvent): void => {
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) {
            return;
        }
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;

        const binWidth = width / numBins;
        const binIdx = Math.floor(cx / binWidth);
        if (binIdx < 0 || binIdx >= numBins) {
            return;
        }

        const val = Math.max(0, Math.min(1, 1 - cy / (height - 12)));
        const newValues = [...values];

        // Paint with a brush (affect neighboring bins for smoother editing)
        for (let offset = -1; offset <= 1; offset++) {
            const idx = binIdx + offset;
            if (idx >= 0 && idx < numBins) {
                const falloff = 1.0 - Math.abs(offset) * 0.3;
                newValues[idx] = val * falloff + (newValues[idx] ?? 0.5) * (1 - falloff);
            }
        }

        setValues(newValues);
    };

    const handlePointerDown = (e: React.PointerEvent): void => {
        drawingRef.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        updateBinsFromPointer(e);
    };

    const handlePointerMove = (e: React.PointerEvent): void => {
        if (!drawingRef.current) {
            return;
        }
        updateBinsFromPointer(e);
    };

    const handlePointerUp = (): void => {
        if (drawingRef.current) {
            drawingRef.current = false;
            onBinValuesChange(values);
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
                Spectral {mode === 'gate' ? 'Gate' : 'Blur'}
            </span>
        </div>
    );
};
