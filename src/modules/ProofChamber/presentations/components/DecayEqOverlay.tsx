/**
 * DecayEqOverlay — interactive 6-band Decay Rate EQ overlay on the spectrogram.
 *
 * 6 draggable nodes on a frequency axis, each controlling a band's decay multiplier.
 * The curve shows how decay time varies across the frequency spectrum.
 * Overlaid on top of the spectrogram canvas.
 */
import { type ReactElement, useRef, useEffect, type PointerEvent } from 'react';

const BAND_FREQS = [100, 400, 1200, 3500, 8000, 12000];
const BAND_LABELS = ['LF', 'LM', 'Mid', 'UM', 'HF', 'Air'];
const MIN_MULT = 0.25;
const MAX_MULT = 4.0;

type DecayEqOverlayProps = {
    multipliers: number[];
    onChange: (bandIndex: number, multiplier: number) => void;
    /**
     * True while the selected algorithm has no recirculating path for a
     * per-band decay multiplier to act on, so a drag would write a value the
     * engine drops.
     *
     * The curve is still drawn — it is what the project has saved, and hiding
     * it would make a stored shape invisible rather than merely inaudible —
     * but the nodes refuse to move. Same treatment as `GatedChip` and
     * `KnobCell` on the panel: a knob that turns and does nothing is
     * indistinguishable from a broken one.
     */
    disabled?: boolean;
    width: number;
    height: number;
};

/** Map frequency (Hz) to X position on canvas (log scale). */
function freqToX(freq: number, width: number): number {
    const logMin = Math.log10(20);
    const logMax = Math.log10(20000);
    const logFreq = Math.log10(freq);
    return ((logFreq - logMin) / (logMax - logMin)) * width;
}

/** Map multiplier (0.25-4.0) to Y position. Center (1.0) is middle. */
function multToY(mult: number, height: number): number {
    // Log scale: 0.25x → bottom, 1.0x → center, 4.0x → top
    const logMult = Math.log2(mult);
    // logMult: -2 (0.25x) to +2 (4.0x), center at 0 (1.0x)
    const normalized = (logMult + 2) / 4; // 0 to 1
    return height * (1 - normalized);
}

/** Inverse: Y position to multiplier. */
function yToMult(y: number, height: number): number {
    const normalized = 1 - y / height;
    const logMult = normalized * 4 - 2;
    return 2 ** logMult;
}

export const DecayEqOverlay = ({
    multipliers,
    onChange,
    disabled = false,
    width,
    height,
}: DecayEqOverlayProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragRef = useRef<{ bandIndex: number } | null>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return;
        }

        ctx.clearRect(0, 0, width, height);

        // Draw center line (1.0x = no change)
        const centerY = multToY(1.0, height);
        ctx.strokeStyle = 'rgba(127,195,210,0.12)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(0, centerY);
        ctx.lineTo(width, centerY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Additional subtle reference lines at 0.5x and 2.0x
        ctx.strokeStyle = 'rgba(127,184,196,0.05)';
        ctx.lineWidth = 0.5;
        for (const mult of [0.5, 2.0]) {
            const y = multToY(mult, height);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw curve through the 6 band points
        ctx.beginPath();
        for (let px = 0; px < width; px++) {
            // Convert pixel to frequency
            const logMin = Math.log10(20);
            const logMax = Math.log10(20000);
            const freq = 10 ** (logMin + (px / width) * (logMax - logMin));

            // Interpolate multiplier from nearest bands
            let mult = 1.0;
            let totalWeight = 0;
            for (let b = 0; b < 6; b++) {
                const dist = Math.abs(Math.log2(freq) - Math.log2(BAND_FREQS[b]!));
                const w = Math.max(0, 1 - dist / 2);
                mult += (multipliers[b]! - 1.0) * w;
                totalWeight += w;
            }
            if (totalWeight > 0) {
                mult = 1.0 + (mult - 1.0) / totalWeight;
            }

            const y = multToY(mult, height);
            if (px === 0) {
                ctx.moveTo(px, y);
            } else {
                ctx.lineTo(px, y);
            }
        }
        // Glow pass
        ctx.save();
        ctx.shadowColor = 'rgba(127,200,220,0.35)';
        ctx.shadowBlur = 8;
        ctx.strokeStyle = 'rgba(127,200,220,0.65)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();

        // Crisp pass
        ctx.strokeStyle = 'rgba(140,200,220,0.7)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Draw band nodes
        for (let b = 0; b < 6; b++) {
            const x = freqToX(BAND_FREQS[b]!, width);
            const y = multToY(multipliers[b]!, height);

            // Node circle — glow
            ctx.save();
            ctx.shadowColor = 'rgba(127,210,230,0.5)';
            ctx.shadowBlur = 10;
            ctx.fillStyle = 'rgba(130,200,220,0.95)';
            ctx.beginPath();
            ctx.arc(x, y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();

            // Node outline
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Label
            ctx.fillStyle = 'rgba(255,255,255,0.55)';
            ctx.font = '8px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(BAND_LABELS[b]!, x, y - 10);

            // Value
            ctx.fillStyle = 'rgba(140,200,220,0.6)';
            ctx.fillText(`${multipliers[b]!.toFixed(1)}×`, x, y + 14);
        }
    }, [multipliers, width, height]);

    const findNearestBand = (clientX: number, clientY: number): number | null => {
        const canvas = canvasRef.current;
        if (!canvas) {
            return null;
        }
        const rect = canvas.getBoundingClientRect();
        const x = (clientX - rect.left) * (width / rect.width);
        const y = (clientY - rect.top) * (height / rect.height);

        let nearest = -1;
        let nearestDist = 20; // max grab distance in pixels
        for (let b = 0; b < 6; b++) {
            const bx = freqToX(BAND_FREQS[b]!, width);
            const by = multToY(multipliers[b]!, height);
            const dist = Math.sqrt((x - bx) ** 2 + (y - by) ** 2);
            if (dist < nearestDist) {
                nearestDist = dist;
                nearest = b;
            }
        }
        return nearest >= 0 ? nearest : null;
    };

    const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>): void => {
        if (disabled) {
            return;
        }
        const band = findNearestBand(event.clientX, event.clientY);
        if (band !== null) {
            dragRef.current = { bandIndex: band };
            (event.target as HTMLCanvasElement).setPointerCapture(event.pointerId);
        }
    };

    const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>): void => {
        if (disabled || !dragRef.current) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        const rect = canvas.getBoundingClientRect();
        const y = (event.clientY - rect.top) * (height / rect.height);
        const mult = yToMult(y, height);
        onChange(dragRef.current.bandIndex, Math.max(MIN_MULT, Math.min(MAX_MULT, mult)));
    };

    const handlePointerUp = (): void => {
        dragRef.current = null;
    };

    return (
        <canvas
            ref={canvasRef}
            width={width}
            height={height}
            className={disabled ? 'absolute inset-0 cursor-not-allowed' : 'absolute inset-0 cursor-crosshair'}
            aria-disabled={disabled || undefined}
            style={{ pointerEvents: 'auto' }}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
        />
    );
};
