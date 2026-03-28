/**
 * LFO section — visualization-first.
 * Large shape preview with shape selector, rate + mod amount knobs.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { LFO_SHAPE_NAMES } from '../../models/FermenterPatch';

type LfoSectionProps = {
    rate: number; shape: number; pitchAmount: number; filterAmount: number;
    onRateChange: (v: number) => void; onShapeChange: (v: number) => void;
    onPitchAmountChange: (v: number) => void; onFilterAmountChange: (v: number) => void;
};

const LfoPreview = ({ shape, rate }: { shape: number; rate: number }): ReactElement => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        const w = 200, h = 60;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.scale(dpr, dpr);

        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = 'rgba(255,255,255,0.06)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, h / 2); ctx.lineTo(w, h / 2); ctx.stroke();

        ctx.strokeStyle = 'var(--color-accent-peach)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        const cycles = Math.max(1, Math.min(4, rate));
        for (let i = 0; i < w; i++) {
            const phase = ((i / w) * cycles) % 1;
            let v = 0;
            switch (shape) {
                case 0: v = Math.sin(phase * Math.PI * 2); break;
                case 1: v = phase < 0.5 ? phase * 4 - 1 : 3 - phase * 4; break;
                case 2: v = 1 - phase * 2; break;
                case 3: v = phase < 0.5 ? 1 : -1; break;
            }
            const y = ((1 - v) / 2) * (h - 4) + 2;
            if (i === 0) ctx.moveTo(i, y); else ctx.lineTo(i, y);
        }
        ctx.stroke();
    }, [shape, rate]);
    return <canvas ref={canvasRef} style={{ width: 200, height: 60 }} className="rounded" />;
};

export const LfoSection = ({
    rate, shape, pitchAmount, filterAmount,
    onRateChange, onShapeChange, onPitchAmountChange, onFilterAmountChange,
}: LfoSectionProps): ReactElement => (
    <div className="space-y-2 w-full max-w-[260px]">
        <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">LFO</span>
            <div className="flex gap-0.5">
                {LFO_SHAPE_NAMES.map((name, i) => (
                    <button key={name} type="button"
                        className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${shape === i ? 'bg-[var(--color-accent-peach)] text-white' : 'text-muted-foreground/40 hover:text-foreground'}`}
                        onClick={() => onShapeChange(i)}
                    >{name.slice(0, 3)}</button>
                ))}
            </div>
        </div>

        {/* HERO: Large LFO preview */}
        <div className="rounded-md overflow-hidden border border-border/20 bg-black/20">
            <LfoPreview shape={shape} rate={rate} />
        </div>

        {/* Knobs */}
        <div className="flex items-end gap-2">
            <div className="flex flex-col items-center gap-0">
                <RotaryKnob value={rate} onChange={onRateChange} min={0} max={20} step={0.1} defaultValue={0} size="lg" />
                <span className="text-[7px] text-muted-foreground">Rate</span>
                <span className="text-[6px] text-muted-foreground/50 font-mono">{rate.toFixed(1)}Hz</span>
            </div>
            <div className="flex flex-col items-center gap-0">
                <RotaryKnob value={pitchAmount} onChange={onPitchAmountChange} min={-1} max={1} step={0.01} defaultValue={0} size="lg" />
                <span className="text-[7px] text-muted-foreground">→ Pitch</span>
            </div>
            <div className="flex flex-col items-center gap-0">
                <RotaryKnob value={filterAmount} onChange={onFilterAmountChange} min={-1} max={1} step={0.01} defaultValue={0} size="lg" />
                <span className="text-[7px] text-muted-foreground">→ Filter</span>
            </div>
        </div>
    </div>
);
