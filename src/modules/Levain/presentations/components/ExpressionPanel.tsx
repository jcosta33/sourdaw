/**
 * ExpressionPanel — CC1/CC11 dynamics and vibrato controls.
 *
 * Hero: Interactive dynamics curve visualization.
 * Below: RotaryKnobs for crossfade time, vibrato depth/rate/onset.
 * Matches the visual density of Fermenter's Filter section.
 */
import { type ReactElement, useRef, useEffect } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { type ExpressionConfig, type LegatoConfig } from '../../models/LevainPatch';

type ExpressionPanelProps = {
    expression: ExpressionConfig;
    legato: LegatoConfig;
    onChangeExp: (partial: Partial<ExpressionConfig>) => void;
    onChangeLeg: (partial: Partial<LegatoConfig>) => void;
};

// ── Dynamics curve visualization ────────────────────────────────────
const DynamicsCurve = ({ curve, crossfadeTime }: { curve: string; crossfadeTime: number }): ReactElement => {
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

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.2)';
        ctx.fillRect(0, 0, w, h);

        // Grid lines
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let i = 1; i < 6; i++) {
            const x = (w * i) / 6;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();
        }

        // Dynamic layer labels
        const labels = ['pp', 'p', 'mp', 'mf', 'f', 'ff'];
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'center';
        for (let i = 0; i < 6; i++) {
            const x = (w * (i + 0.5)) / 6;
            ctx.fillText(labels[i] ?? '', x, h - 4);
        }

        // CC1 response curve
        ctx.strokeStyle = 'rgba(245,158,11,0.8)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let px = 0; px < w; px++) {
            const x = px / w;
            let y: number;
            if (curve === 's-curve') {
                y = x * x * (3 - 2 * x);
            } else if (curve === 'logarithmic') {
                const clamped = Math.max(0.01, x);
                y = Math.max(0, (Math.log(clamped) + 4.6) / 4.6);
            } else {
                y = x;
            }
            const py = h - y * (h - 16);
            if (px === 0) {
                ctx.moveTo(px, py);
            } else {
                ctx.lineTo(px, py);
            }
        }
        ctx.stroke();

        // CC1 label
        ctx.fillStyle = 'rgba(245,158,11,0.5)';
        ctx.font = '9px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText('CC1 → Dynamics', 6, 12);

        // Crossfade time indicator
        ctx.fillStyle = 'rgba(255,255,255,0.3)';
        ctx.font = '8px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(`${Math.round(crossfadeTime * 1000)}ms xfade`, w - 6, 12);
    }, [curve, crossfadeTime]);

    return (
        <canvas
            ref={canvasRef}
            width={320}
            height={100}
            className="rounded-md border border-border/20 w-full max-w-[320px]"
        />
    );
};

export const ExpressionPanel = ({
    expression,
    legato,
    onChangeExp,
    onChangeLeg,
}: ExpressionPanelProps): ReactElement => {
    return (
        <Stack gap={3} className="max-w-[340px]">
            {/* Header */}
            <DawPluginSectionHeader
                title="Expression"
                titleClassName="text-muted-foreground"
                className="gap-3"
                actions={
                    <>
                        <Row align="stretch" gap={0.5}>
                            {(['linear', 's-curve', 'logarithmic'] as const).map((c) => (
                                <DawPluginChip
                                    key={c}
                                    active={expression.cc1Curve === c}
                                    tone="amber"
                                    size="xs"
                                    caps={false}
                                    onClick={() => onChangeExp({ cc1Curve: c })}
                                >
                                    {c === 's-curve' ? 'S-Curve' : c.charAt(0).toUpperCase() + c.slice(1)}
                                </DawPluginChip>
                            ))}
                        </Row>
                        <DawPluginToggle
                            pressed={legato.enabled}
                            tone="mint"
                            size="xs"
                            caps={false}
                            className="ml-auto"
                            onClick={() => onChangeLeg({ enabled: !legato.enabled })}
                        >
                            Legato {legato.enabled ? 'On' : 'Off'}
                        </DawPluginToggle>
                    </>
                }
            />

            {/* Hero: dynamics curve */}
            <DynamicsCurve curve={expression.cc1Curve} crossfadeTime={expression.dynamicCrossfadeTime} />

            {/* Knob row: crossfade + vibrato controls */}
            <Row align="end" gap={3}>
                <Stack align="center">
                    <RotaryKnob
                        value={expression.dynamicCrossfadeTime}
                        onChange={(v) => onChangeExp({ dynamicCrossfadeTime: v })}
                        min={0.02}
                        max={0.3}
                        step={0.005}
                        defaultValue={0.1}
                        size="lg"
                        tone="amber"
                    />
                    <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Xfade</span>
                    <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                        {Math.round(expression.dynamicCrossfadeTime * 1000)}ms
                    </span>
                </Stack>

                <Row align="end" gap={2} className="border-l border-border/15 pl-3">
                    <Stack align="center">
                        <RotaryKnob
                            value={expression.vibratoDepthMax}
                            onChange={(v) => onChangeExp({ vibratoDepthMax: v })}
                            min={0}
                            max={50}
                            step={1}
                            defaultValue={20}
                            size="lg"
                            tone="amber"
                        />
                        <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Vib Depth</span>
                        <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                            {expression.vibratoDepthMax.toFixed(0)}ct
                        </span>
                    </Stack>

                    {/* Rate Min/Max form an ordered pair (engine sweeps CC2 across
                        [rate_min, rate_max]); clamp each knob against the other at
                        the gesture receiver so an inverted range can never be
                        written — same normalize-on-receipt pattern as Transport's
                        setLoopRegion for loopStart/loopEnd. */}
                    <Stack align="center">
                        <RotaryKnob
                            value={expression.vibratoRateMin}
                            onChange={(v) => onChangeExp({ vibratoRateMin: Math.min(v, expression.vibratoRateMax) })}
                            min={2}
                            max={7}
                            step={0.1}
                            defaultValue={4}
                            size="md"
                            tone="amber"
                        />
                        <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Rate Min</span>
                        <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                            {expression.vibratoRateMin.toFixed(1)}Hz
                        </span>
                    </Stack>
                    <Stack align="center">
                        <RotaryKnob
                            value={expression.vibratoRateMax}
                            onChange={(v) => onChangeExp({ vibratoRateMax: Math.max(v, expression.vibratoRateMin) })}
                            min={2}
                            max={9}
                            step={0.1}
                            defaultValue={7}
                            size="md"
                            tone="amber"
                        />
                        <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Rate Max</span>
                        <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                            {expression.vibratoRateMax.toFixed(1)}Hz
                        </span>
                    </Stack>

                    <Stack align="center">
                        <RotaryKnob
                            value={expression.vibratoOnsetDelay}
                            onChange={(v) => onChangeExp({ vibratoOnsetDelay: v })}
                            min={0}
                            max={0.5}
                            step={0.01}
                            defaultValue={0.2}
                            size="md"
                            tone="amber"
                        />
                        <span className="text-[7px] text-muted-foreground/60 uppercase tracking-wider">Onset</span>
                        <span className="text-[6px] text-muted-foreground/40 tabular-nums">
                            {Math.round(expression.vibratoOnsetDelay * 1000)}ms
                        </span>
                    </Stack>
                </Row>
            </Row>
        </Stack>
    );
};
