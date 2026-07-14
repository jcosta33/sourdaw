/**
 * ProofDynSection — Multiband dynamics controls.
 * 4-band compressor with crossover frequencies, per-band threshold/ratio/attack/release.
 */
import { type ReactElement } from 'react';

import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';

import { type ProofPatch } from '../../models/ProofPatch';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;
const BAND_COLORS = [
    'var(--color-accent-peach)',
    'var(--color-accent-mint)',
    'var(--color-accent-cyan)',
    'var(--color-accent-lavender)',
];

type Props = {
    patch: ProofPatch;
    dynGr: [number, number, number, number];
    onPatchChange: (partial: Partial<ProofPatch>) => void;
};

export const ProofDynSection = ({ patch, dynGr, onPatchChange }: Props): ReactElement => {
    const updateBand = (idx: number, key: string, value: number | boolean) => {
        const bands = patch.dynBands.map((b, i) => (i === idx ? { ...b, [key]: value } : b));
        onPatchChange({ dynBands: bands });
    };

    const updateXover = (idx: number, value: number) => {
        const freqs: [number, number, number] = [...patch.dynCrossoverFreqs];
        freqs[idx] = value;
        onPatchChange({ dynCrossoverFreqs: freqs });
    };

    return (
        <div className="flex flex-col gap-1.5 px-2">
            <DawPluginSectionHeader
                title="Multiband Dynamics"
                size="xs"
                titleClassName="text-[var(--color-accent-peach)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.dynBypassed}
                        tone="peach"
                        size="xs"
                        onClick={() => {
                            onPatchChange({ dynBypassed: !patch.dynBypassed });
                        }}
                    >
                        {patch.dynBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            {/* Crossover frequencies */}
            <div className="flex items-center gap-2 px-1">
                <span className="text-[7px] text-muted-foreground">Crossovers:</span>
                {patch.dynCrossoverFreqs.map((freq, i) => (
                    <div key={i} className="flex items-center gap-0.5">
                        <RotaryKnob
                            value={freq}
                            onChange={(v) => updateXover(i, v)}
                            min={20}
                            max={20000}
                            step={1}
                            defaultValue={freq}
                            size="sm"
                            tone="cyan"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${freq.toFixed(0)}`}
                        </span>
                    </div>
                ))}
            </div>

            {/* Per-band controls */}
            <div className={`flex gap-1 ${patch.dynBypassed ? 'opacity-30' : ''}`}>
                {BAND_LABELS.map((label, i) => {
                    const band = patch.dynBands[i]!;
                    const gr = dynGr[i] ?? 0;
                    return (
                        <div
                            key={i}
                            className="flex-1 flex flex-col items-center gap-0.5 px-1 py-1 rounded bg-surface-base/50"
                        >
                            <span className="text-[7px] font-bold uppercase" style={{ color: BAND_COLORS[i] }}>
                                {label}
                            </span>

                            {/* GR meter bar */}
                            <div className="w-full h-1 bg-surface-inset rounded overflow-hidden">
                                <div
                                    className="h-full transition-all duration-75"
                                    style={{
                                        width: `${Math.min(100, (Math.abs(gr) / 20) * 100)}%`,
                                        backgroundColor: BAND_COLORS[i],
                                    }}
                                />
                            </div>
                            <span className="text-[6px] text-muted-foreground font-mono">{gr.toFixed(1)} dB</span>

                            <RotaryKnob
                                value={band.threshold}
                                onChange={(v) => updateBand(i, 'threshold', v)}
                                min={-60}
                                max={0}
                                step={0.5}
                                defaultValue={-20}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Thr</span>

                            <RotaryKnob
                                value={band.ratio}
                                onChange={(v) => updateBand(i, 'ratio', v)}
                                min={1}
                                max={20}
                                step={0.5}
                                defaultValue={2}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Ratio</span>

                            <RotaryKnob
                                value={band.attack}
                                onChange={(v) => updateBand(i, 'attack', v)}
                                min={1}
                                max={200}
                                step={1}
                                defaultValue={10}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Atk</span>

                            <RotaryKnob
                                value={band.release}
                                onChange={(v) => updateBand(i, 'release', v)}
                                min={10}
                                max={2000}
                                step={1}
                                defaultValue={100}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Rel</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
