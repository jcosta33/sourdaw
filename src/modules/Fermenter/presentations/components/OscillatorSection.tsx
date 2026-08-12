/**
 * Oscillator section — visualization-first.
 * Large waveform display as hero, controls alongside.
 */
import { type ReactElement } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginSectionHeader } from '#/components/daw/DawPluginSectionHeader';
import { RotaryKnob, type RotaryKnobComponent } from '#/components/daw/RotaryKnob';
import { OscillatorWaveform } from '#/components/daw/visualizers/OscillatorWaveform';

import { ENGINE_NAMES, WAVEFORM_NAMES, NOISE_COLOR_NAMES } from '../../models/FermenterPatch';

const WAVEFORM_KEYS = ['sine', 'sawtooth', 'square', 'triangle'] as const;

type OscillatorSectionProps = {
    rotaryKnob?: RotaryKnobComponent;
    engine: number;
    waveform: number;
    level: number;
    coarse: number;
    fine: number;
    pulseWidth: number;
    noiseLevel: number;
    noiseColor: number;
    onEngineChange: (v: number) => void;
    onWaveformChange: (wf: number) => void;
    onLevelChange: (v: number) => void;
    onCoarseChange: (v: number) => void;
    onFineChange: (v: number) => void;
    onPulseWidthChange: (v: number) => void;
    onNoiseLevelChange: (v: number) => void;
    onNoiseColorChange: (v: number) => void;
};

export const OscillatorSection = ({
    rotaryKnob: Knob = RotaryKnob,
    engine,
    waveform,
    level,
    coarse,
    fine,
    pulseWidth,
    noiseLevel,
    noiseColor,
    onEngineChange,
    onWaveformChange,
    onLevelChange,
    onCoarseChange,
    onFineChange,
    onPulseWidthChange,
    onNoiseLevelChange,
    onNoiseColorChange,
}: OscillatorSectionProps): ReactElement => {
    const wfKey = WAVEFORM_KEYS[waveform] ?? 'sawtooth';
    const showPW = engine === 1 && waveform === 2;

    return (
        <div className="space-y-2 w-full max-w-[300px]">
            {/* Header: title + engine selector */}
            <DawPluginSectionHeader
                title="Oscillator"
                titleClassName="text-muted-foreground"
                actions={
                    <div className="flex gap-0.5">
                        {ENGINE_NAMES.map((name, i) => (
                            <DawPluginChip
                                key={name}
                                active={engine === i}
                                tone="cyan"
                                size="xs"
                                onClick={() => onEngineChange(i)}
                            >
                                {name}
                            </DawPluginChip>
                        ))}
                    </div>
                }
            />

            {/* HERO: Large waveform visualization */}
            <div className="rounded-md overflow-hidden border border-border/20 bg-black/20">
                <OscillatorWaveform
                    waveform={wfKey}
                    osc2Waveform={wfKey}
                    osc2Mix={0}
                    detune={0}
                    width={290}
                    height={80}
                />
            </div>

            {/* Waveform selector */}
            <div className="flex gap-0.5">
                {WAVEFORM_NAMES.map((name, i) => (
                    <DawPluginChip
                        key={name}
                        active={waveform === i}
                        tone="lavender"
                        size="xs"
                        shape="soft"
                        className="flex-1"
                        onClick={() => onWaveformChange(i)}
                    >
                        {name}
                    </DawPluginChip>
                ))}
            </div>

            {/* Knob row: Level + Coarse + Fine + (PW) */}
            <div className="flex items-end gap-2">
                <Knob
                    paramId="oscLevel"
                    value={level}
                    onChange={onLevelChange}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.8}
                    size="lg"
                    label="Level"
                    tone="sage"
                />
                <Knob
                    paramId="oscCoarse"
                    value={coarse}
                    onChange={onCoarseChange}
                    min={-24}
                    max={24}
                    step={1}
                    defaultValue={0}
                    size="lg"
                    label="Coarse"
                    tone="sage"
                />
                <Knob
                    paramId="oscFine"
                    value={fine}
                    onChange={onFineChange}
                    min={-100}
                    max={100}
                    step={0.1}
                    defaultValue={0}
                    size="lg"
                    label="Fine"
                    tone="sage"
                />
                {showPW ? (
                    <Knob
                        paramId="pulseWidth"
                        value={pulseWidth}
                        onChange={onPulseWidthChange}
                        min={0.05}
                        max={0.95}
                        step={0.01}
                        defaultValue={0.5}
                        size="lg"
                        label="PW"
                        tone="sage"
                    />
                ) : null}
            </div>

            {/* Noise sub-row */}
            <div className="flex items-end gap-2 pt-1 border-t border-border/15">
                <Knob
                    paramId="noiseLevel"
                    value={noiseLevel}
                    onChange={onNoiseLevelChange}
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0}
                    size="md"
                    label="Noise"
                    tone="sage"
                />
                <div className="flex gap-0.5 pb-2">
                    {NOISE_COLOR_NAMES.map((name, i) => (
                        <DawPluginChip
                            key={name}
                            active={noiseColor === i}
                            tone="neutral"
                            size="xs"
                            caps={false}
                            onClick={() => onNoiseColorChange(i)}
                        >
                            {name}
                        </DawPluginChip>
                    ))}
                </div>
            </div>
        </div>
    );
};
