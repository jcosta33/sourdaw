/**
 * ProofEqSection — 8-band parametric EQ with interactive controls.
 * Knobs for freq/gain/Q per band, band type selector, M/S per-band.
 */
import { type ReactElement } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Stack } from '#/components/layout';

import { type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

import { ProofEqCurve } from './ProofEqCurve';

const BAND_TYPES = ['Peak', 'Lo Shelf', 'Hi Shelf', 'HP', 'LP'] as const;
const CHANNEL_MODES = ['L/R', 'Mid', 'Side'] as const;
const EQ_BAND_KEYS = ['low-cut', 'low-shelf', 'low-mid', 'mid', 'high-mid', 'high', 'high-shelf', 'high-cut'] as const;
const EQ_BAND_LABELS = [
    'Low Cut',
    'Low Shelf',
    'Low-Mid',
    'Mid',
    'High-Mid',
    'High',
    'High Shelf',
    'High Cut',
] as const;
const BAND_COLORS = ['#6BAACE', '#52BA46', '#E0AA2A', '#FF5F80', '#4CB8B8', '#954EB2', '#6BAACE', '#52BA46'];

type Props = {
    patch: ProofPatch;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofEqSection = ({ patch, gestureOwner, gestureAuthority, onPatchChange }: Props): ReactElement => {
    const updatePatch = <Key extends keyof ProofPatch['eqBands'][number]>(
        idx: number,
        key: Key,
        value: ProofPatch['eqBands'][number][Key],
        isTransient = false
    ) => {
        const bands = patch.eqBands.map((band, index) => (index === idx ? { ...band, [key]: value } : band));
        onPatchChange({
            key: 'eqBands',
            value: bands,
            changedParams: [{ bandIndex: idx, field: key }],
            isTransient,
        });
    };

    return (
        <Stack gap={1.5} className="px-2">
            <DawPluginSectionHeader
                title="EQ"
                size="xs"
                titleClassName="text-[var(--color-accent-cyan)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.eqBypassed}
                        aria-label="EQ module"
                        tone="cyan"
                        size="xs"
                        onClick={() => {
                            const value = !patch.eqBypassed;
                            onPatchChange({
                                key: 'eqBypassed',
                                value,
                                isTransient: false,
                            });
                        }}
                    >
                        {patch.eqBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            {/* Interactive frequency response graph */}
            <div className={patch.eqBypassed ? 'opacity-30' : ''}>
                <ProofEqCurve
                    patch={patch}
                    width={500}
                    height={120}
                    gestureOwner={gestureOwner}
                    gestureAuthority={gestureAuthority}
                    onPatchChange={onPatchChange}
                />
            </div>

            <div className={`flex gap-1 overflow-x-auto ${patch.eqBypassed ? 'opacity-30' : ''}`}>
                {patch.eqBands.map((band, i) => (
                    <Stack
                        align="center"
                        gap={0.5}
                        className="min-w-[52px] px-0.5 py-1 rounded bg-surface-base/50"
                        key={EQ_BAND_KEYS[i]}
                    >
                        {/* Enable toggle */}
                        <button
                            type="button"
                            aria-label={`EQ ${EQ_BAND_LABELS[i]!} band`}
                            aria-pressed={band.enabled}
                            className={`w-2 h-2 rounded-full cursor-pointer ${band.enabled ? '' : 'opacity-20'}`}
                            style={{ backgroundColor: BAND_COLORS[i] }}
                            onClick={() => {
                                const next = !band.enabled;
                                updatePatch(i, 'enabled', next);
                            }}
                        />

                        {/* Frequency */}
                        <RotaryKnob
                            value={band.freq}
                            aria-label={`EQ ${EQ_BAND_LABELS[i]!} frequency`}
                            onChange={(value, isTransient) => updatePatch(i, 'freq', value, isTransient)}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            min={20}
                            max={20000}
                            step={1}
                            defaultValue={band.freq}
                            size="sm"
                            tone="cyan"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(1)}k` : `${band.freq.toFixed(0)}`}
                        </span>

                        {/* Gain */}
                        <RotaryKnob
                            value={band.gain}
                            aria-label={`EQ ${EQ_BAND_LABELS[i]!} gain`}
                            onChange={(value, isTransient) => updatePatch(i, 'gain', value, isTransient)}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            min={-18}
                            max={18}
                            step={0.5}
                            defaultValue={0}
                            size="sm"
                            tone="cyan"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {band.gain > 0 ? '+' : ''}
                            {band.gain.toFixed(1)}
                        </span>

                        {/* Q */}
                        <RotaryKnob
                            value={band.q}
                            aria-label={`EQ ${EQ_BAND_LABELS[i]!} Q`}
                            onChange={(value, isTransient) => updatePatch(i, 'q', value, isTransient)}
                            gestureOwner={gestureOwner}
                            gestureAuthority={gestureAuthority}
                            min={0.1}
                            max={10}
                            step={0.1}
                            defaultValue={1}
                            tone="cyan"
                            size="sm"
                        />
                        <span className="text-[6px] text-muted-foreground font-mono">Q{band.q.toFixed(1)}</span>

                        {/* Band type */}
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="w-full text-[6px]"
                            value={band.type}
                            onChange={(event) => updatePatch(i, 'type', Number.parseInt(event.target.value, 10))}
                        >
                            {BAND_TYPES.map((label, ti) => (
                                <option key={label} value={ti}>
                                    {label}
                                </option>
                            ))}
                        </DawCompactSelect>

                        {/* M/S channel */}
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="w-full text-[6px]"
                            value={band.channel}
                            onChange={(event) => updatePatch(i, 'channel', Number.parseInt(event.target.value, 10))}
                        >
                            {CHANNEL_MODES.map((label, ci) => (
                                <option key={label} value={ci}>
                                    {label}
                                </option>
                            ))}
                        </DawCompactSelect>
                    </Stack>
                ))}
            </div>
        </Stack>
    );
};
