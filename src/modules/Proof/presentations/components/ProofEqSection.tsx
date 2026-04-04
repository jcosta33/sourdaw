/**
 * ProofEqSection — 8-band parametric EQ with interactive controls.
 * Knobs for freq/gain/Q per band, band type selector, M/S per-band.
 */
import { type ReactElement } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type ProofPatch } from '../../models/ProofPatch';
import { ProofEqCurve } from './ProofEqCurve';

const BAND_TYPES = ['Peak', 'Lo Shelf', 'Hi Shelf', 'HP', 'LP'] as const;
const CHANNEL_MODES = ['L/R', 'Mid', 'Side'] as const;
const BAND_COLORS = ['#6BAACE', '#52BA46', '#E0AA2A', '#FF5F80', '#4CB8B8', '#954EB2', '#6BAACE', '#52BA46'];

type Props = {
    patch: ProofPatch;
    onPatchChange: (partial: Partial<ProofPatch>) => void;
    onSendParam: (name: string, value: number) => void;
};

export const ProofEqSection = ({ patch, onPatchChange, onSendParam }: Props): ReactElement => {
    const updateBand = (idx: number, key: string, value: number | boolean) => {
        const bands = patch.eqBands.map((b, i) =>
            i === idx ? { ...b, [key]: value } : b
        );
        onPatchChange({ eqBands: bands });
        onSendParam(`eq_band${idx}_${key}`, value as number);
    };

    return (
        <div className="flex flex-col gap-1.5 px-2">
            <DawPluginSectionHeader
                title="EQ"
                size="xs"
                titleClassName="text-[var(--color-accent-cyan)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.eqBypassed}
                        tone="cyan"
                        size="xs"
                        onClick={() => {
                            onPatchChange({ eqBypassed: !patch.eqBypassed });
                            onSendParam('eq_bypass', patch.eqBypassed ? 0 : 1);
                        }}
                    >
                        {patch.eqBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            {/* Interactive frequency response graph */}
            <div className={patch.eqBypassed ? 'opacity-30' : ''}>
                <ProofEqCurve patch={patch} width={500} height={120} onPatchChange={onPatchChange} onSendParam={onSendParam} />
            </div>

            <div className={`flex gap-1 overflow-x-auto ${patch.eqBypassed ? 'opacity-30' : ''}`}>
                {patch.eqBands.map((band, i) => (
                    <div key={i} className="flex flex-col items-center gap-0.5 min-w-[52px] px-0.5 py-1 rounded bg-surface-base/50">
                        {/* Enable toggle */}
                        <button
                            type="button"
                            className={`w-2 h-2 rounded-full cursor-pointer ${band.enabled ? '' : 'opacity-20'}`}
                            style={{ backgroundColor: BAND_COLORS[i] }}
                            onClick={() => {
                                updateBand(i, 'enabled', !band.enabled);
                                onSendParam(`eq_band${i}_enabled`, band.enabled ? 0 : 1);
                            }}
                        />

                        {/* Frequency */}
                        <RotaryKnob value={band.freq} onChange={(v) => { updateBand(i, 'freq', v); onSendParam(`eq_band${i}_freq`, v); }}
                            min={20} max={20000} step={1} defaultValue={band.freq} size="sm" />
                        <span className="text-[6px] text-muted-foreground font-mono">
                            {band.freq >= 1000 ? `${(band.freq / 1000).toFixed(1)}k` : `${band.freq.toFixed(0)}`}
                        </span>

                        {/* Gain */}
                        <RotaryKnob value={band.gain} onChange={(v) => { updateBand(i, 'gain', v); onSendParam(`eq_band${i}_gain`, v); }}
                            min={-18} max={18} step={0.5} defaultValue={0} size="sm" />
                        <span className="text-[6px] text-muted-foreground font-mono">{band.gain > 0 ? '+' : ''}{band.gain.toFixed(1)}</span>

                        {/* Q */}
                        <RotaryKnob value={band.q} onChange={(v) => { updateBand(i, 'q', v); onSendParam(`eq_band${i}_q`, v); }}
                            min={0.1} max={10} step={0.1} defaultValue={1} size="sm" />
                        <span className="text-[6px] text-muted-foreground font-mono">Q{band.q.toFixed(1)}</span>

                        {/* Band type */}
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="w-full text-[6px]"
                            value={band.type}
                            onChange={(e) => {
                                const t = parseInt(e.target.value);
                                updateBand(i, 'type', t);
                                onSendParam(`eq_band${i}_type`, t);
                            }}
                        >
                            {BAND_TYPES.map((label, ti) => (
                                <option key={ti} value={ti}>{label}</option>
                            ))}
                        </DawCompactSelect>

                        {/* M/S channel */}
                        <DawCompactSelect
                            size="micro"
                            tone="inset"
                            className="w-full text-[6px]"
                            value={band.channel}
                            onChange={(e) => {
                                const c = parseInt(e.target.value);
                                updateBand(i, 'channel', c);
                                onSendParam(`eq_band${i}_channel`, c);
                            }}
                        >
                            {CHANNEL_MODES.map((label, ci) => (
                                <option key={ci} value={ci}>{label}</option>
                            ))}
                        </DawCompactSelect>
                    </div>
                ))}
            </div>
        </div>
    );
};
