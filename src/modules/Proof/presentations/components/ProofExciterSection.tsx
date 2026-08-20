/**
 * ProofExciterSection — Per-band harmonic exciter with saturation type selection.
 */
import { type ReactElement } from 'react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Stack } from '#/components/layout';

import { type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;
const SAT_TYPES = ['Tape', 'Tube', 'Transistor', 'Warm'] as const;
type Props = {
    patch: ProofPatch;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofExciterSection = ({ patch, gestureOwner, gestureAuthority, onPatchChange }: Props): ReactElement => {
    const updateBand = <Key extends keyof ProofPatch['excBands'][number]>(
        idx: number,
        key: Key,
        value: ProofPatch['excBands'][number][Key],
        isTransient = false
    ) => {
        const bands = patch.excBands.map((band, index) => (index === idx ? { ...band, [key]: value } : band));
        onPatchChange({
            key: 'excBands',
            value: bands,
            changedParams: [{ bandIndex: idx, field: key }],
            isTransient,
        });
    };

    return (
        <Stack gap={1.5} className="px-2">
            <DawPluginSectionHeader
                title="Harmonic Exciter"
                size="xs"
                titleClassName="text-[var(--color-accent-lavender)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.excBypassed}
                        aria-label="Exciter module"
                        tone="lavender"
                        size="xs"
                        onClick={() => {
                            const value = !patch.excBypassed;
                            onPatchChange({
                                key: 'excBypassed',
                                value,
                                isTransient: false,
                            });
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
                        <Stack
                            align="center"
                            grow
                            gap={0.5}
                            className="px-1 py-1 rounded bg-surface-base/50"
                            key={label}
                        >
                            <span className="text-[7px] text-muted-foreground">{label}</span>

                            {/* Enable */}
                            <DawPluginToggle
                                pressed={band.enabled}
                                aria-label={`${label} exciter band`}
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
                                onChange={(event) => updateBand(i, 'type', Number.parseInt(event.target.value, 10))}
                            >
                                {SAT_TYPES.map((t, ti) => (
                                    <option key={t} value={ti}>
                                        {t}
                                    </option>
                                ))}
                            </DawCompactSelect>

                            {/* Drive */}
                            <RotaryKnob
                                value={band.drive}
                                aria-label={`Exciter ${label} drive`}
                                onChange={(value, isTransient) => updateBand(i, 'drive', value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.2}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Drive</span>

                            {/* Blend */}
                            <RotaryKnob
                                value={band.blend}
                                aria-label={`Exciter ${label} blend`}
                                onChange={(value, isTransient) => updateBand(i, 'blend', value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.3}
                                size="sm"
                                tone="cyan"
                            />
                            <span className="text-[6px] text-muted-foreground">Blend</span>
                        </Stack>
                    );
                })}
            </div>
        </Stack>
    );
};
