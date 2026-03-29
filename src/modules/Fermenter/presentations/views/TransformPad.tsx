/**
 * Transform Pad — 4-corner XY interpolation between patches.
 * Drag the puck to morph between four corner presets in real time.
 * Part of the Level 5 (Lab) experience.
 */
import { type ReactElement, useRef, useState, useCallback, useEffect } from 'react';
import { type FermenterPatch, DEFAULT_PATCH } from '../../models/FermenterPatch';
import { FERMENTER_PRESETS } from '../../useCases/fermenterQueries';
import { bilinearPatch, applyMorphedPatch } from '../../useCases/presetMorph';

type TransformPadProps = Record<string, never>;

const PAD_SIZE = 160;

/** Extract a FermenterPatch from a preset's device params */
function presetToPatch(presetId: string): FermenterPatch {
    const preset = FERMENTER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return { ...DEFAULT_PATCH };
    const pv = preset.devices[0]?.parameterValues;
    if (!pv) return { ...DEFAULT_PATCH };
    const patch = { ...DEFAULT_PATCH, name: preset.name };
    for (const [key, val] of Object.entries(pv)) {
        if (key in patch && typeof val === 'number') {
            (patch as Record<string, unknown>)[key] = val;
        }
    }
    return patch;
}

const CORNER_PRESETS = [
    'fermenter-init',         // TL
    'fermenter-supersaw',     // TR
    'fermenter-dark-drone',   // BL
    'fermenter-acid-bass',    // BR
];

export const TransformPad = (_props: TransformPadProps): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [puck, setPuck] = useState({ x: 0.5, y: 0.5 });
    const [dragging, setDragging] = useState(false);
    const [corners] = useState(() => CORNER_PRESETS.map(presetToPatch));

    const applyPosition = useCallback((x: number, y: number) => {
        const morphed = bilinearPatch(corners[0]!, corners[1]!, corners[2]!, corners[3]!, x, y);
        morphed.name = 'Transform';
        applyMorphedPatch(morphed);
    }, [corners]);

    const handlePointer = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = (e.target as HTMLCanvasElement).getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
        setPuck({ x, y });
        applyPosition(x, y);
    }, [applyPosition]);

    // Draw
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = PAD_SIZE * dpr;
        canvas.height = PAD_SIZE * dpr;
        ctx.scale(dpr, dpr);

        // Background gradient
        const grad = ctx.createLinearGradient(0, 0, PAD_SIZE, PAD_SIZE);
        grad.addColorStop(0, 'rgba(96, 200, 232, 0.1)');
        grad.addColorStop(0.5, 'rgba(30, 30, 50, 0.8)');
        grad.addColorStop(1, 'rgba(184, 136, 232, 0.1)');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, PAD_SIZE, PAD_SIZE);

        // Grid
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 4; i++) {
            const pos = (i / 4) * PAD_SIZE;
            ctx.beginPath();
            ctx.moveTo(pos, 0); ctx.lineTo(pos, PAD_SIZE);
            ctx.moveTo(0, pos); ctx.lineTo(PAD_SIZE, pos);
            ctx.stroke();
        }

        // Corner labels
        ctx.font = '8px system-ui';
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        const labels = corners.map((c) => c.name.replace('Fermenter — ', '').slice(0, 8));
        ctx.textAlign = 'left';
        ctx.fillText(labels[0] ?? '', 4, 12);
        ctx.textAlign = 'right';
        ctx.fillText(labels[1] ?? '', PAD_SIZE - 4, 12);
        ctx.textAlign = 'left';
        ctx.fillText(labels[2] ?? '', 4, PAD_SIZE - 4);
        ctx.textAlign = 'right';
        ctx.fillText(labels[3] ?? '', PAD_SIZE - 4, PAD_SIZE - 4);

        // Puck
        const px = puck.x * PAD_SIZE;
        const py = puck.y * PAD_SIZE;

        // Glow
        const glow = ctx.createRadialGradient(px, py, 0, px, py, 20);
        glow.addColorStop(0, 'rgba(168, 130, 255, 0.3)');
        glow.addColorStop(1, 'rgba(168, 130, 255, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(px - 20, py - 20, 40, 40);

        // Dot
        ctx.fillStyle = '#A882FF';
        ctx.beginPath();
        ctx.arc(px, py, 5, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 1;
        ctx.stroke();
    }, [puck, corners]);

    return (
        <div className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                Transform Pad
            </div>
            <canvas
                ref={canvasRef}
                style={{ width: PAD_SIZE, height: PAD_SIZE, cursor: dragging ? 'grabbing' : 'grab' }}
                className="rounded-lg border border-border/30"
                onPointerDown={(e) => {
                    setDragging(true);
                    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
                    handlePointer(e);
                }}
                onPointerMove={(e) => { if (dragging) handlePointer(e); }}
                onPointerUp={() => setDragging(false)}
            />
        </div>
    );
};
