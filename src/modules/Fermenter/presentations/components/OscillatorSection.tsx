/**
 * Oscillator section — engine selector, waveform, tuning, noise, pulse width.
 */
import { type ReactElement } from 'react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { OscillatorWaveform } from '#/modules/Workspace/presentations/components/OscillatorWaveform';
import { ENGINE_NAMES, WAVEFORM_NAMES, NOISE_COLOR_NAMES } from '../../models/FermenterPatch';

const WAVEFORM_KEYS = ['sine', 'sawtooth', 'square', 'triangle'] as const;

type OscillatorSectionProps = {
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
    const showPulseWidth = engine === 1 && waveform === 2; // VA + square

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between px-1">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Oscillator
                </div>
                {/* Engine selector */}
                <div className="flex gap-0.5">
                    {ENGINE_NAMES.map((name, i) => (
                        <button
                            key={name}
                            type="button"
                            className={`px-1.5 py-0.5 rounded text-[8px] font-medium transition-colors ${
                                engine === i
                                    ? 'bg-[var(--color-accent-cyan)]/80 text-white'
                                    : 'text-muted-foreground/60 hover:text-foreground'
                            }`}
                            onClick={() => onEngineChange(i)}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            </div>

            {/* Waveform display */}
            <div className="flex justify-center">
                <OscillatorWaveform
                    waveform={wfKey}
                    osc2Waveform={wfKey}
                    osc2Mix={0}
                    detune={0}
                    width={220}
                    height={52}
                />
            </div>

            {/* Waveform selector */}
            <div className="flex gap-1 justify-center">
                {WAVEFORM_NAMES.map((name, i) => (
                    <button
                        key={name}
                        type="button"
                        className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                            waveform === i
                                ? 'bg-[var(--color-accent-lavender)] text-white'
                                : 'bg-surface-raised/50 text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => onWaveformChange(i)}
                    >
                        {name}
                    </button>
                ))}
            </div>

            {/* Knob row: Level, Coarse, Fine, (PW) */}
            <div className="flex items-end gap-2 px-1">
                <div className="flex flex-col items-center gap-0.5">
                    <RotaryKnob value={level} onChange={onLevelChange} min={0} max={1} step={0.01} defaultValue={0.8} size="lg" />
                    <span className="text-[8px] text-muted-foreground">Level</span>
                    <span className="text-[7px] text-muted-foreground/60 font-mono">{Math.round(level * 100)}%</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                    <RotaryKnob value={coarse} onChange={onCoarseChange} min={-24} max={24} step={1} defaultValue={0} size="lg" />
                    <span className="text-[8px] text-muted-foreground">Coarse</span>
                    <span className="text-[7px] text-muted-foreground/60 font-mono">{coarse > 0 ? '+' : ''}{coarse}st</span>
                </div>
                <div className="flex flex-col items-center gap-0.5">
                    <RotaryKnob value={fine} onChange={onFineChange} min={-100} max={100} step={1} defaultValue={0} size="lg" />
                    <span className="text-[8px] text-muted-foreground">Fine</span>
                    <span className="text-[7px] text-muted-foreground/60 font-mono">{fine > 0 ? '+' : ''}{fine}ct</span>
                </div>
                {showPulseWidth ? (
                    <div className="flex flex-col items-center gap-0.5">
                        <RotaryKnob value={pulseWidth} onChange={onPulseWidthChange} min={0.05} max={0.95} step={0.01} defaultValue={0.5} size="lg" />
                        <span className="text-[8px] text-muted-foreground">PW</span>
                        <span className="text-[7px] text-muted-foreground/60 font-mono">{Math.round(pulseWidth * 100)}%</span>
                    </div>
                ) : null}
            </div>

            {/* Noise sub-section */}
            <div className="flex items-end gap-2 px-1 pt-1 border-t border-border/20">
                <div className="flex flex-col items-center gap-0.5">
                    <RotaryKnob value={noiseLevel} onChange={onNoiseLevelChange} min={0} max={1} step={0.01} defaultValue={0} size="lg" />
                    <span className="text-[8px] text-muted-foreground">Noise</span>
                    <span className="text-[7px] text-muted-foreground/60 font-mono">{Math.round(noiseLevel * 100)}%</span>
                </div>
                <div className="flex gap-0.5 pb-1">
                    {NOISE_COLOR_NAMES.map((name, i) => (
                        <button
                            key={name}
                            type="button"
                            className={`px-1 py-0.5 rounded text-[7px] font-medium transition-colors ${
                                noiseColor === i
                                    ? 'bg-muted text-foreground'
                                    : 'text-muted-foreground/50 hover:text-foreground'
                            }`}
                            onClick={() => onNoiseColorChange(i)}
                        >
                            {name}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};
