/**
 * ProofImagerSection — Per-band stereo width controls + correlation meter.
 */
import { type ReactElement } from 'react';

import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob, type GestureAuthority } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import { type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';

const BAND_LABELS = ['Sub', 'Low-Mid', 'Hi-Mid', 'High'] as const;

type Props = {
    patch: ProofPatch;
    correlation: number;
    gestureOwner: number;
    gestureAuthority?: GestureAuthority;
    onPatchChange: (edit: ProofPatchEdit) => void;
};

export const ProofImagerSection = ({
    patch,
    correlation,
    gestureOwner,
    gestureAuthority,
    onPatchChange,
}: Props): ReactElement => {
    const updateWidth = (idx: number, value: number, isTransient = false) => {
        const widths: [number, number, number, number] = [...patch.imgBandWidth];
        widths[idx] = value;
        onPatchChange({
            key: 'imgBandWidth',
            value: widths,
            changedParams: [{ bandIndex: idx }],
            isTransient,
        });
    };

    // Correlation bar color
    let corrColor: string;
    if (correlation > 0.5) {
        corrColor = 'var(--color-accent-mint)';
    } else if (correlation > 0) {
        corrColor = 'var(--color-accent-peach)';
    } else {
        corrColor = 'var(--color-state-danger)';
    }

    return (
        <Stack gap={1.5} className="px-2">
            <DawPluginSectionHeader
                title="Stereo Imager"
                size="xs"
                titleClassName="text-[var(--color-accent-mint)]"
                actions={
                    <DawPluginToggle
                        pressed={!patch.imgBypassed}
                        aria-label="Imager module"
                        tone="mint"
                        size="xs"
                        onClick={() => {
                            const value = !patch.imgBypassed;
                            onPatchChange({
                                key: 'imgBypassed',
                                value,
                                isTransient: false,
                            });
                        }}
                    >
                        {patch.imgBypassed ? 'OFF' : 'ON'}
                    </DawPluginToggle>
                }
            />

            <div className={`flex flex-col gap-2 ${patch.imgBypassed ? 'opacity-30' : ''}`}>
                {/* Per-band width knobs */}
                <Row align="stretch" justify="around">
                    {BAND_LABELS.map((label, i) => (
                        <Stack align="center" gap={0.5} key={label}>
                            <span className="text-[7px] text-muted-foreground">{label}</span>
                            <RotaryKnob
                                value={patch.imgBandWidth[i]!}
                                aria-label={`Imager ${label} width`}
                                onChange={(value, isTransient) => updateWidth(i, value, isTransient)}
                                gestureOwner={gestureOwner}
                                gestureAuthority={gestureAuthority}
                                min={0}
                                max={2}
                                step={0.01}
                                defaultValue={i === 0 ? 0 : 1}
                                size="md"
                                tone="cyan"
                            />
                            <span className="text-[7px] text-muted-foreground font-mono">
                                {patch.imgBandWidth[i]! === 0
                                    ? 'Mono'
                                    : `${(patch.imgBandWidth[i]! * 100).toFixed(0)}%`}
                            </span>
                        </Stack>
                    ))}
                </Row>

                {/* Auto mono bass */}
                <Row gap={2} className="px-1">
                    <DawPluginToggle
                        pressed={patch.imgAutoMonoBass}
                        aria-label="Imager auto mono bass"
                        tone="mint"
                        size="xs"
                        caps={false}
                        onClick={() => {
                            const value = !patch.imgAutoMonoBass;
                            onPatchChange({
                                key: 'imgAutoMonoBass',
                                value,
                                isTransient: false,
                            });
                        }}
                    >
                        Auto Mono Bass
                    </DawPluginToggle>
                    <RotaryKnob
                        value={patch.imgMonoBassFreq}
                        aria-label="Imager auto mono bass frequency"
                        onChange={(value, isTransient) => {
                            onPatchChange({
                                key: 'imgMonoBassFreq',
                                value,
                                isTransient,
                            });
                        }}
                        gestureOwner={gestureOwner}
                        gestureAuthority={gestureAuthority}
                        min={40}
                        max={200}
                        step={1}
                        defaultValue={80}
                        size="sm"
                        tone="cyan"
                    />
                    <span className="text-[6px] text-muted-foreground font-mono">
                        {patch.imgMonoBassFreq.toFixed(0)} Hz
                    </span>
                </Row>

                {/* Correlation meter */}
                <Row gap={2} className="px-1">
                    <span className="text-[7px] text-muted-foreground shrink-0">Correlation</span>
                    <div className="flex-1 h-2 bg-surface-inset rounded overflow-hidden relative">
                        {/* Center line */}
                        <div className="absolute left-1/2 top-0 w-px h-full bg-border/30" />
                        {/* Bar */}
                        <div
                            className="absolute top-0 h-full rounded transition-all duration-100"
                            style={{
                                backgroundColor: corrColor,
                                left: correlation >= 0 ? '50%' : `${50 + correlation * 50}%`,
                                width: `${Math.abs(correlation) * 50}%`,
                            }}
                        />
                    </div>
                    <span className="text-[7px] text-muted-foreground font-mono w-8 text-right">
                        {correlation.toFixed(2)}
                    </span>
                </Row>
            </div>
        </Stack>
    );
};
