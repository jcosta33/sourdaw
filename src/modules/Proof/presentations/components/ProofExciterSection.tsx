/**
 * ProofExciterSection — Per-band harmonic exciter with saturation type selection.
 */
import { type ReactElement } from 'react';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type ProofPatch } from '../../models/ProofPatch';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;
const SAT_TYPES = ['Tape', 'Tube', 'Transistor', 'Warm'] as const;
type Props = {
    patch: ProofPatch;
    onPatchChange: (partial: Partial<ProofPatch>) => void;
    onSendParam: (name: string, value: number) => void;
};

export const ProofExciterSection = ({ patch, onPatchChange, onSendParam }: Props): ReactElement => {
    const updateBand = (idx: number, key: string, value: number | boolean) => {
        const bands = patch.excBands.map((b, i) =>
            i === idx ? { ...b, [key]: value } : b
        );
        onPatchChange({ excBands: bands });
        onSendParam(`exc_band${idx}_${key}`, typeof value === 'boolean' ? (value ? 1 : 0) : value);
    };

    return (
        <div className="flex flex-col gap-1.5 px-2">
            <DawPluginSectionHeader
                title="Harmonic Exciter"
                size="xs"
                titleClassName="text-[var(--color-accent-lavender)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.excBypassed}
                        tone="lavender"
                        size="xs"
                        onClick={() => {
                            onPatchChange({ excBypassed: !patch.excBypassed });
                            onSendParam('exc_bypass', patch.excBypassed ? 0 : 1);
                        }}
                    >
                        {patch.excBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            <div className={`flex gap-1 ${patch.excBypassed ? 'opacity-30' : ''}`}>
                {BAND_LABELS.map((label, i) => {
                    const band = patch.excBands[i]!;
                    return (
                        <div key={i} className="flex-1 flex flex-col items-center gap-0.5 px-1 py-1 rounded bg-surface-base/50">
                            <span className="text-[7px] text-muted-foreground">{label}</span>

                            {/* Enable */}
                            <DawPluginToggle
                                pressed={band.enabled}
                                tone="lavender"
                                size="xs"
                                className="w-full"
                                onClick={() => updateBand(i, 'enabled', !band.enabled)}
                            >
                                {band.enabled ? 'ON' : 'OFF'}
                            </DawPluginToggle>

                            {/* Saturation type */}
                            <DawCompactSelect
                                size="micro"
                                tone="inset"
                                className="w-full text-[6px]"
                                value={band.type}
                                onChange={(e) => updateBand(i, 'type', parseInt(e.target.value))}
                            >
                                {SAT_TYPES.map((t, ti) => (
                                    <option key={ti} value={ti}>{t}</option>
                                ))}
                            </DawCompactSelect>

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
