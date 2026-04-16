/**
 * Crumbs parameter controls — mode switcher, envelope knobs, filter knobs.
 */

import { type ReactElement } from 'react';
import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import type { EnvelopeParams, FilterType, CrumbsMode, VoiceStackParams } from '../../models/CrumbsTypes';

type CrumbsControlsProps = {
    mode: CrumbsMode;
    envelope: EnvelopeParams;
    filterCutoff: number;
    filterResonance: number;
    filterType: FilterType;
    masterGain: number;
    tune: number;
    pan: number;
    voiceStack?: VoiceStackParams;
    onModeChange: (mode: CrumbsMode) => void;
    onEnvelopeChange: (updates: Partial<EnvelopeParams>) => void;
    onFilterChange: (cutoff?: number, resonance?: number) => void;
    onGainChange: (gain: number) => void;
    onTuneChange: (tune: number) => void;
    onPanChange: (pan: number) => void;
    onStackChange?: (updates: Partial<VoiceStackParams>) => void;
};

const MODES: CrumbsMode[] = ['quick', 'drum', 'slice', 'warp', 'record'];

const Knob = ({
    value,
    label,
    min,
    max,
    step,
    defaultValue,
    onChange,
    readout,
}: {
    value: number;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    onChange: (value: number) => void;
    readout: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            tone="lavender"
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </div>
);

export const CrumbsControls = ({
    mode,
    envelope,
    filterCutoff,
    filterResonance,
    masterGain,
    tune,
    pan,
    voiceStack,
    onModeChange,
    onEnvelopeChange,
    onFilterChange,
    onGainChange,
    onTuneChange,
    onPanChange,
    onStackChange,
}: CrumbsControlsProps): ReactElement => {
    return (
        <div className="flex flex-col gap-4">
            {/* Mode switcher */}
            <div className="flex items-center gap-1.5">
                {MODES.map((m) => (
                    <DawPluginChip key={m} active={mode === m} tone="lavender" size="sm" onClick={() => onModeChange(m)}>
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                    </DawPluginChip>
                ))}
            </div>

            {/* Envelope */}
            <div>
                <div className="mb-2 text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">Envelope</div>
                <div className="grid grid-cols-5 gap-x-2 gap-y-3">
                    <Knob
                        value={envelope.attack}
                        onChange={(v) => onEnvelopeChange({ attack: v })}
                        label="Atk"
                        min={0.001}
                        max={2}
                        step={0.001}
                        defaultValue={0.001}
                        readout={
                            envelope.attack < 0.01
                                ? `${(envelope.attack * 1000).toFixed(0)}ms`
                                : `${envelope.attack.toFixed(2)}s`
                        }
                    />
                    <Knob
                        value={envelope.hold}
                        onChange={(v) => onEnvelopeChange({ hold: v })}
                        label="Hold"
                        min={0}
                        max={2}
                        step={0.001}
                        defaultValue={0}
                        readout={`${(envelope.hold * 1000).toFixed(0)}ms`}
                    />
                    <Knob
                        value={envelope.decay}
                        onChange={(v) => onEnvelopeChange({ decay: v })}
                        label="Dec"
                        min={0.001}
                        max={5}
                        step={0.001}
                        defaultValue={0.3}
                        readout={`${envelope.decay.toFixed(2)}s`}
                    />
                    <Knob
                        value={envelope.sustain}
                        onChange={(v) => onEnvelopeChange({ sustain: v })}
                        label="Sus"
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={1}
                        readout={`${Math.round(envelope.sustain * 100)}%`}
                    />
                    <Knob
                        value={envelope.release}
                        onChange={(v) => onEnvelopeChange({ release: v })}
                        label="Rel"
                        min={0.001}
                        max={10}
                        step={0.001}
                        defaultValue={0.1}
                        readout={`${envelope.release.toFixed(2)}s`}
                    />
                </div>
            </div>

            {/* Filter + Master */}
            <div>
                <div className="mb-2 text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">
                    Filter & Output
                </div>
                <div className="grid grid-cols-5 gap-x-2 gap-y-3">
                    <Knob
                        value={filterCutoff}
                        onChange={(v) => onFilterChange(v, undefined)}
                        label="Cutoff"
                        min={20}
                        max={20000}
                        step={10}
                        defaultValue={20000}
                        readout={
                            filterCutoff >= 1000 ? `${(filterCutoff / 1000).toFixed(1)}k` : `${filterCutoff.toFixed(0)}`
                        }
                    />
                    <Knob
                        value={filterResonance}
                        onChange={(v) => onFilterChange(undefined, v)}
                        label="Reso"
                        min={0.5}
                        max={20}
                        step={0.1}
                        defaultValue={1}
                        readout={filterResonance.toFixed(1)}
                    />
                    <Knob
                        value={masterGain}
                        onChange={onGainChange}
                        label="Gain"
                        min={0}
                        max={2}
                        step={0.01}
                        defaultValue={0.8}
                        readout={`${Math.round(masterGain * 100)}%`}
                    />
                    <Knob
                        value={tune}
                        onChange={onTuneChange}
                        label="Tune"
                        min={-24}
                        max={24}
                        step={0.1}
                        defaultValue={0}
                        readout={`${tune > 0 ? '+' : ''}${tune.toFixed(1)}st`}
                    />
                    <Knob
                        value={pan}
                        onChange={onPanChange}
                        label="Pan"
                        min={-1}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        readout={
                            pan === 0
                                ? 'C'
                                : pan < 0
                                  ? `L${Math.abs(Math.round(pan * 100))}`
                                  : `R${Math.round(pan * 100)}`
                        }
                    />
                </div>
            </div>

            {/* Voice Stacking */}
            {voiceStack && onStackChange ? (
                <div>
                    <div className="mb-2 text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">
                        Voice Stack
                    </div>
                    <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                        <Knob
                            value={voiceStack.stackCount}
                            onChange={(v) => onStackChange({ stackCount: Math.round(v) })}
                            label="Voices"
                            min={1}
                            max={8}
                            step={1}
                            defaultValue={1}
                            readout={`${voiceStack.stackCount}`}
                        />
                        <Knob
                            value={voiceStack.detuneSpread}
                            onChange={(v) => onStackChange({ detuneSpread: v })}
                            label="Detune"
                            min={0}
                            max={100}
                            step={0.5}
                            defaultValue={0}
                            readout={`${voiceStack.detuneSpread.toFixed(1)}¢`}
                        />
                        <Knob
                            value={voiceStack.stackSpread}
                            onChange={(v) => onStackChange({ stackSpread: v })}
                            label="Spread"
                            min={0}
                            max={1}
                            step={0.01}
                            defaultValue={0}
                            readout={`${Math.round(voiceStack.stackSpread * 100)}%`}
                        />
                    </div>
                </div>
            ) : null}
        </div>
    );
};
