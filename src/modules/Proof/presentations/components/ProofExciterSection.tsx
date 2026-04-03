/**
 * ProofExciterSection — Per-band harmonic exciter with saturation type selection.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type ProofPatch } from '../../models/ProofPatch';
import { updateProofPatch } from '../../stores/proofStore';
import { setProofParam } from '../../useCases/proofParamBridge';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;
const SAT_TYPES = ['Tape', 'Tube', 'Transistor', 'Warm'] as const;
type Props = { patch: ProofPatch; deviceId: string };

export const ProofExciterSection = ({ patch, deviceId }: Props): ReactElement => {
    const updateBand = (idx: number, key: string, value: number | boolean) => {
        const bands = patch.excBands.map((b, i) =>
            i === idx ? { ...b, [key]: value } : b
        );
        updateProofPatch(deviceId, { excBands: bands });
        setProofParam(deviceId, `exc_band${idx}_${key}`, typeof value === 'boolean' ? (value ? 1 : 0) : value);
    };

    return (
        <div className="flex flex-col gap-1.5 px-2">
            <div className="flex items-center justify-between">
                <span className="text-[8px] font-bold text-[var(--color-accent-lavender)] uppercase tracking-wider">Harmonic Exciter</span>
                <button
                    type="button"
                    className={`text-[7px] px-1.5 py-0.5 rounded cursor-pointer ${patch.excBypassed ? 'text-muted-foreground' : 'text-[var(--color-accent-lavender)]'}`}
                    onClick={() => {
                        updateProofPatch(deviceId, { excBypassed: !patch.excBypassed });
                        setProofParam(deviceId, 'exc_bypass', patch.excBypassed ? 0 : 1);
                    }}
                >
                    {patch.excBypassed ? 'OFF' : 'ON'}
                </button>
            </div>

            <div className={`flex gap-1 ${patch.excBypassed ? 'opacity-30' : ''}`}>
                {BAND_LABELS.map((label, i) => {
                    const band = patch.excBands[i]!;
                    return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 px-1 py-1 rounded bg-surface-base/50">
                            <span className="text-[7px] text-muted-foreground">{label}</span>

                            {/* Enable */}
                            <button
                                type="button"
                                className={`w-full text-[6px] py-0.5 rounded cursor-pointer ${band.enabled ? 'bg-[var(--color-accent-lavender)]/20 text-[var(--color-accent-lavender)]' : 'text-muted-foreground/50'}`}
                                onClick={() => updateBand(i, 'enabled', !band.enabled)}
                            >
                                {band.enabled ? 'ON' : 'OFF'}
                            </button>

                            {/* Saturation type */}
                            <select
                                className="w-full h-4 text-[6px] bg-surface-inset border border-border/30 rounded px-0.5 text-foreground cursor-pointer"
                                value={band.type}
                                onChange={(e) => updateBand(i, 'type', parseInt(e.target.value))}
                            >
                                {SAT_TYPES.map((t, ti) => (
                                    <option key={ti} value={ti}>{t}</option>
                                ))}
                            </select>

                            {/* Drive */}
                            <RotaryKnob value={band.drive} onChange={(v) => updateBand(i, 'drive', v)}
                                min={0} max={1} step={0.01} defaultValue={0.2} size="sm" />
                            <span className="text-[6px] text-muted-foreground">Drive</span>

                            {/* Blend */}
                            <RotaryKnob value={band.blend} onChange={(v) => updateBand(i, 'blend', v)}
                                min={0} max={1} step={0.01} defaultValue={0.3} size="sm" />
                            <span className="text-[6px] text-muted-foreground">Blend</span>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
