/**
 * ProofDynSection — Multiband dynamics controls.
 * 4-band compressor with crossover frequencies, per-band threshold/ratio/attack/release.
 */
import { type ReactElement } from 'react';

import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { PROOF_PATCH_RANGES, type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;
const CROSSOVER_KEYS = ['low', 'mid', 'high'] as const;
const BAND_COLORS = [
    'var(--color-accent-peach)',
    'var(--color-accent-mint)',
    'var(--color-accent-cyan)',
    'var(--color-accent-lavender)',
];

type Props = {
    patch: ProofPatch;
    dynGr: [number, number, number, number];
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofDynSection = ({
    patch,
    dynGr,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: Props): ReactElement => {
    const updateBand = (
        idx: number,
        key: 'threshold' | 'ratio' | 'attack' | 'release',
        value: number,
        isTransient = false
    ) => {
        const bands = patch.dynBands.map((band, index) => (index === idx ? { ...band, [key]: value } : band));
        onPatchChange({
            key: 'dynBands',
            value: bands,
            changedParams: [{ bandIndex: idx, field: key }],
            isTransient,
        });
    };

    const updateXover = (idx: number, value: number, isTransient = false) => {
        const freqs: [number, number, number] = [...patch.dynCrossoverFreqs];
        freqs[idx] = value;
        onPatchChange({
            key: 'dynCrossoverFreqs',
            value: freqs,
            changedParams: [{ crossoverIndex: idx }],
            isTransient,
        });
    };

    return (
        <Stack gap={1.5} className="px-2">
            <DawPluginSectionHeader
                title="Multiband Dynamics"
                size="xs"
                titleClassName="text-[var(--color-accent-peach)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.dynBypassed}
                        aria-label="Dynamics module"
                        tone="peach"
                        size="xs"
                        onClick={() => {
                            const value = !patch.dynBypassed;
                            onPatchChange({
                                key: 'dynBypassed',
                                value,
                                isTransient: false,
                            });
                        }}
                    >
                        {patch.dynBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            {/* Crossover frequencies */}
            <Row gap={2} className="px-1">
                <span className="text-[7px] text-muted-foreground">Crossovers:</span>
                {patch.dynCrossoverFreqs.map((freq, i) => {
                    const crossoverKey = CROSSOVER_KEYS[i]!;
                    const previous = patch.dynCrossoverFreqs[i - 1];
                    const next = patch.dynCrossoverFreqs[i + 1];
                    const [rangeMin, rangeMax] = PROOF_PATCH_RANGES.dynCrossoverFreq;
                    const min = previous === undefined ? rangeMin : Math.min(freq, previous + 1);
                    const max = next === undefined ? rangeMax : Math.max(freq, next - 1);

                    return (
                        <Row gap={0.5} key={crossoverKey}>
                            <RotaryKnob
                                value={freq}
                                aria-label={`Dynamics ${crossoverKey} crossover frequency`}
                                onChange={(value, isTransient) => updateXover(i, value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
                                min={min}
                                max={max}
                                step={1}
                                defaultValue={freq}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground font-mono">
                                {freq >= 1000 ? `${(freq / 1000).toFixed(1)}k` : `${freq.toFixed(0)}`}
                            </span>
                        </Row>
                    );
                })}
            </Row>

            {/* Per-band controls */}
            <div className={`flex gap-1 ${patch.dynBypassed ? 'opacity-30' : ''}`}>
                {BAND_LABELS.map((label, i) => {
                    const band = patch.dynBands[i]!;
                    const gr = dynGr[i] ?? 0;
                    return (
                        <Stack
                            align="center"
                            grow
                            gap={0.5}
                            className="px-1 py-1 rounded bg-surface-base/50"
                            key={label}
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
                                aria-label={`Dynamics ${label} threshold`}
                                onChange={(value, isTransient) => updateBand(i, 'threshold', value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
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
                                aria-label={`Dynamics ${label} ratio`}
                                onChange={(value, isTransient) => updateBand(i, 'ratio', value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
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
                                aria-label={`Dynamics ${label} attack`}
                                onChange={(value, isTransient) => updateBand(i, 'attack', value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
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
                                aria-label={`Dynamics ${label} release`}
                                onChange={(value, isTransient) => updateBand(i, 'release', value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
                                min={10}
                                max={2000}
                                step={1}
                                defaultValue={100}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Rel</span>
                        </Stack>
                    );
                })}
            </div>
        </Stack>
    );
};
