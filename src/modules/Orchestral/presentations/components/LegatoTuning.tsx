/**
 * LegatoTuning — legato engine controls with hero visualization.
 *
 * Hero: crossfade timing diagram.
 * Below: RotaryKnobs for thresholds and portamento velocity.
 */
import { type ReactElement, useRef, useEffect } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type LegatoConfig } from '../../models/OrchestraPatch';
import { setOrchestraParamWithAudio } from '../../useCases/orchestralParamBridge';

type LegatoTuningProps = {
    config: LegatoConfig;
};

// ── Legato visualization ────────────────────────────────────────────
const LegatoDiagram = ({ slowMs, fastMs }: { slowMs: number; fastMs: number }): ReactElement => {
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

        const w = canvas.width;
        const h = canvas.height;
        ctx.clearRect(0, 0, w, h);

        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);

        // Three zones: Fast | Medium | Slow
        const fastEnd = (fastMs / 500) * w;
        const slowStart = (slowMs / 500) * w;

        // Fast zone
        ctx.fillStyle = 'rgba(245,158,11,0.1)';
        ctx.fillRect(0, 0, fastEnd, h);

        // Slow zone
        ctx.fillStyle = 'rgba(16,185,129,0.1)';
        ctx.fillRect(slowStart, 0, w - slowStart, h);

        // Divider lines
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(fastEnd, 0);
        ctx.lineTo(fastEnd, h);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(slowStart, 0);
        ctx.lineTo(slowStart, h);
        ctx.stroke();
        ctx.setLineDash([]);

        // Labels
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'center';

        ctx.fillStyle = 'rgba(245,158,11,0.7)';
        ctx.fillText('Fast', fastEnd / 2, 14);
        ctx.fillText(`<${fastMs}ms`, fastEnd / 2, h - 6);

        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('Medium', (fastEnd + slowStart) / 2, 14);

        ctx.fillStyle = 'rgba(16,185,129,0.7)';
        ctx.fillText('Slow', (slowStart + w) / 2, 14);
        ctx.fillText(`>${slowMs}ms`, (slowStart + w) / 2, h - 6);

        // Crossfade curve shape hints
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1.5;

        // Short crossfade in fast zone
        ctx.beginPath();
        ctx.moveTo(fastEnd * 0.3, h * 0.65);
        ctx.quadraticCurveTo(fastEnd * 0.5, h * 0.35, fastEnd * 0.7, h * 0.65);
        ctx.stroke();

        // Long crossfade in slow zone
        ctx.beginPath();
        ctx.moveTo(slowStart + (w - slowStart) * 0.15, h * 0.65);
        ctx.quadraticCurveTo(slowStart + (w - slowStart) * 0.5, h * 0.25, slowStart + (w - slowStart) * 0.85, h * 0.65);
        ctx.stroke();
    }, [slowMs, fastMs]);

    return (
        <canvas
            ref={canvasRef}
            width={320}
            height={80}
            className="rounded-md border border-border/20 w-full max-w-[320px]"
        />
    );
};

export const LegatoTuning = ({ config }: LegatoTuningProps): ReactElement => {
    const update = (partial: Partial<LegatoConfig>): void => {
        setOrchestraParamWithAudio('legato', { ...config, ...partial });
    };

    return (
        <div className="space-y-3 max-w-[340px]">
            {/* Header */}
            <div className="flex items-center gap-3">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Legato
                </span>
                <button
                    type="button"
                    className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                        config.adaptiveSpeed
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'text-muted-foreground/40 hover:text-foreground'
                    }`}
                    onClick={() => update({ adaptiveSpeed: !config.adaptiveSpeed })}
                >
                    Adaptive {config.adaptiveSpeed ? 'On' : 'Off'}
                </button>
            </div>

            {/* Hero: legato timing diagram */}
            <LegatoDiagram slowMs={config.slowThresholdMs} fastMs={config.fastThresholdMs} />

            {/* Knob row */}
            <div className="flex items-end gap-3">
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.slowThresholdMs}
                        onChange={(v) => update({ slowThresholdMs: v })}
                        min={150}
                        max={500}
                        step={10}
                        defaultValue={300}
                        size="lg"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Slow
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        {config.slowThresholdMs}ms
                    </span>
                </div>

                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.fastThresholdMs}
                        onChange={(v) => update({ fastThresholdMs: v })}
                        min={30}
                        max={200}
                        step={5}
                        defaultValue={100}
                        size="lg"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Fast
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        {config.fastThresholdMs}ms
                    </span>
                </div>

                <div className="border-l border-border/15 pl-3 flex flex-col items-center gap-0">
                    <RotaryKnob
                        value={config.portamentoVelocityThreshold}
                        onChange={(v) => update({ portamentoVelocityThreshold: Math.round(v) })}
                        min={0}
                        max={127}
                        step={1}
                        defaultValue={64}
                        size="md"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">
                        Porto Vel
                    </span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        {config.portamentoVelocityThreshold}
                    </span>
                </div>
            </div>
        </div>
    );
};
