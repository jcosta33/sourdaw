/**
 * Oscillator section — visualization-first.
 * Large waveform display as hero, controls alongside.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { OscillatorWaveform } from '#/components/daw/visualizers/OscillatorWaveform';
import { ENGINE_NAMES, WAVEFORM_NAMES, NOISE_COLOR_NAMES } from '../../models/FermenterPatch';

const WAVEFORM_KEYS = ['sine', 'sawtooth', 'square', 'triangle'] as const;

type OscillatorSectionProps = {
    engine: number; waveform: number; level: number; coarse: number; fine: number;
    pulseWidth: number; noiseLevel: number; noiseColor: number;
    onEngineChange: (v: number) => void; onWaveformChange: (wf: number) => void;
    onLevelChange: (v: number) => void; onCoarseChange: (v: number) => void;
    onFineChange: (v: number) => void; onPulseWidthChange: (v: number) => void;
    onNoiseLevelChange: (v: number) => void; onNoiseColorChange: (v: number) => void;
};

export const OscillatorSection = ({
    engine, waveform, level, coarse, fine, pulseWidth, noiseLevel, noiseColor,
    onEngineChange, onWaveformChange, onLevelChange, onCoarseChange, onFineChange,
    onPulseWidthChange, onNoiseLevelChange, onNoiseColorChange,
}: OscillatorSectionProps): ReactElement => {
    const wfKey = WAVEFORM_KEYS[waveform] ?? 'sawtooth';
    const showPW = engine === 1 && waveform === 2;

    return (
        <div className="space-y-2 w-full max-w-[300px]">
            {/* Header: title + engine selector */}
            <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Oscillator</span>
                <div className="flex gap-0.5">
                    {ENGINE_NAMES.map((name, i) => (
                        <button key={name} type="button"
                            className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${engine === i ? 'bg-[var(--color-accent-cyan)]/80 text-white' : 'text-muted-foreground/50 hover:text-foreground'}`}
                            onClick={() => onEngineChange(i)}
                        >{name}</button>
                    ))}
                </div>
            </div>

            {/* HERO: Large waveform visualization */}
            <div className="rounded-md overflow-hidden border border-border/20 bg-black/20">
                <OscillatorWaveform waveform={wfKey} osc2Waveform={wfKey} osc2Mix={0} detune={0} width={290} height={80} />
            </div>

            {/* Waveform selector */}
            <div className="flex gap-0.5">
                {WAVEFORM_NAMES.map((name, i) => (
                    <button key={name} type="button"
                        className={`flex-1 py-0.5 rounded text-[8px] font-medium transition-colors ${waveform === i ? 'bg-[var(--color-accent-lavender)] text-white' : 'bg-surface-raised/50 text-muted-foreground hover:text-foreground'}`}
                        onClick={() => onWaveformChange(i)}
                    >{name}</button>
                ))}
            </div>

            {/* Knob row: Level + Coarse + Fine + (PW) */}
            <div className="flex items-end gap-2">
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob paramId="oscLevel" value={level} onChange={onLevelChange} min={0} max={1} step={0.01} defaultValue={0.8} size="lg" />
                    <span className="text-[7px] text-muted-foreground">Level</span>
                </div>
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob paramId="oscCoarse" value={coarse} onChange={onCoarseChange} min={-24} max={24} step={1} defaultValue={0} size="lg" />
                    <span className="text-[7px] text-muted-foreground">Coarse</span>
                </div>
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob paramId="oscFine" value={fine} onChange={onFineChange} min={-100} max={100} step={1} defaultValue={0} size="lg" />
                    <span className="text-[7px] text-muted-foreground">Fine</span>
                </div>
                {showPW ? (
                    <div className="flex flex-col items-center gap-0">
                        <RotaryKnob paramId="pulseWidth" value={pulseWidth} onChange={onPulseWidthChange} min={0.05} max={0.95} step={0.01} defaultValue={0.5} size="lg" />
                        <span className="text-[7px] text-muted-foreground">PW</span>
                    </div>
                ) : null}
            </div>

            {/* Noise sub-row */}
            <div className="flex items-end gap-2 pt-1 border-t border-border/15">
                <div className="flex flex-col items-center gap-0">
                    <RotaryKnob paramId="noiseLevel" value={noiseLevel} onChange={onNoiseLevelChange} min={0} max={1} step={0.01} defaultValue={0} size="md" />
                    <span className="text-[7px] text-muted-foreground">Noise</span>
                </div>
                <div className="flex gap-0.5 pb-2">
                    {NOISE_COLOR_NAMES.map((name, i) => (
                        <button key={name} type="button"
                            className={`px-1 py-0.5 rounded text-[6px] font-medium ${noiseColor === i ? 'bg-muted text-foreground' : 'text-muted-foreground/40 hover:text-foreground'}`}
                            onClick={() => onNoiseColorChange(i)}
                        >{name}</button>
                    ))}
                </div>
            </div>
        </div>
    );
};
