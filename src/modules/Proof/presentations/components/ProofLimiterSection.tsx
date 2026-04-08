/**
 * ProofLimiterSection — Look-ahead limiter controls with GR meter + target presets.
 */
import { type ReactElement } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type ProofPatch } from '../../models/ProofPatch';

const DITHER_MODES = ['Off', 'TPDF', 'Noise Shaped'] as const;
const DITHER_VALUES = ['off', 'tpdf', 'noise_shaped'] as const;

type Props = {
    patch: ProofPatch;
    limiterGrDb: number;
    truePeakDb: number;
    onPatchChange: (partial: Partial<ProofPatch>) => void;
    onSendParam: (name: string, value: number) => void;
};

export const ProofLimiterSection = ({
    patch,
    limiterGrDb,
    truePeakDb,
    onPatchChange,
    onSendParam,
}: Props): ReactElement => {
    return (
        <div className="flex flex-col gap-1.5 px-2">
            <DawPluginSectionHeader
                title="Limiter"
                size="xs"
                titleClassName="text-[var(--color-state-danger)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.limBypassed}
                        tone="danger"
                        size="xs"
                        onClick={() => {
                            onPatchChange({ limBypassed: !patch.limBypassed });
                            onSendParam('lim_bypass', patch.limBypassed ? 0 : 1);
                        }}
                    >
                        {patch.limBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            <div className={`flex gap-4 ${patch.limBypassed ? 'opacity-30' : ''}`}>
                {/* Controls */}
                <div className="flex gap-3">
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob
                            value={patch.limCeiling}
                            onChange={(v) => {
                                onPatchChange({ limCeiling: v });
                                onSendParam('lim_ceiling', v);
                            }}
                            min={-12}
                            max={0}
                            step={0.1}
                            defaultValue={-1}
                            size="md"
                            tone="cyan"
                        />
                        <span className="text-[7px] text-muted-foreground">Ceiling</span>
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {patch.limCeiling.toFixed(1)} dBTP
                        </span>
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob
                            value={patch.limRelease}
                            onChange={(v) => {
                                onPatchChange({ limRelease: v });
                                onSendParam('lim_release', v);
                            }}
                            min={10}
                            max={500}
                            step={1}
                            defaultValue={100}
                            size="md"
                            tone="cyan"
                        />
                        <span className="text-[7px] text-muted-foreground">Release</span>
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {patch.limRelease.toFixed(0)} ms
                        </span>
                    </div>

                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob
                            value={patch.limLookahead}
                            onChange={(v) => {
                                onPatchChange({ limLookahead: v });
                                onSendParam('lim_lookahead', v);
                            }}
                            min={0.5}
                            max={10}
                            step={0.5}
                            defaultValue={5}
                            size="md"
                            tone="cyan"
                        />
                        <span className="text-[7px] text-muted-foreground">Lookahead</span>
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {patch.limLookahead.toFixed(1)} ms
                        </span>
                    </div>
                </div>

                {/* GR + True Peak meters */}
                <div className="flex flex-col gap-1 min-w-[80px]">
                    <div className="flex justify-between text-[7px]">
                        <span className="text-muted-foreground">GR</span>
                        <span className="text-[var(--color-state-danger)] font-mono">{limiterGrDb.toFixed(1)} dB</span>
                    </div>
                    <div className="h-2 bg-surface-inset rounded overflow-hidden">
                        <div
                            className="h-full bg-[var(--color-state-danger)] transition-all duration-75 rounded"
                            style={{ width: `${Math.min(100, (Math.abs(limiterGrDb) / 12) * 100)}%` }}
                        />
                    </div>

                    <div className="flex justify-between text-[7px]">
                        <span className="text-muted-foreground">True Peak</span>
                        <span
                            className={`font-mono ${truePeakDb > -1 ? 'text-[var(--color-state-danger)]' : 'text-foreground'}`}
                        >
                            {truePeakDb > -100 ? `${truePeakDb.toFixed(1)} dBTP` : '-∞'}
                        </span>
                    </div>
                </div>

                {/* Dither */}
                <div className="flex flex-col gap-1">
                    <span className="text-[7px] text-muted-foreground">Dither</span>
                    <DawCompactSelect
                        size="micro"
                        tone="inset"
                        className="text-[7px]"
                        value={DITHER_VALUES.indexOf(patch.ditherMode as (typeof DITHER_VALUES)[number])}
                        onChange={(e) => {
                            const mode = DITHER_VALUES[parseInt(e.target.value)]!;
                            onPatchChange({ ditherMode: mode });
                            onSendParam('dither_mode', parseInt(e.target.value));
                        }}
                    >
                        {DITHER_MODES.map((label, i) => (
                            <option key={i} value={i}>
                                {label}
                            </option>
                        ))}
                    </DawCompactSelect>
                    <div className="flex items-center gap-1">
                        <span className="text-[6px] text-muted-foreground">Bits:</span>
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="text-[6px]"
                            value={patch.ditherBits}
                            onChange={(e) => {
                                const bits = parseInt(e.target.value);
                                onPatchChange({ ditherBits: bits });
                                onSendParam('dither_bits', bits);
                            }}
                        >
                            <option value={16}>16</option>
                            <option value={24}>24</option>
                        </DawCompactSelect>
                    </div>
                </div>
            </div>
        </div>
    );
};
