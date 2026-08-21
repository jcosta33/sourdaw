/**
 * Crumbs parameter controls — mode switcher, envelope knobs, filter knobs.
 */

import { type ReactElement } from 'react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Row, Stack } from '#/components/layout';

import type { CrumbsPersistedParamId } from '../../models/CrumbsParameterMap';
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
    /**
     * One handler for the ten knobs that ride `Device.parameterValues`, addressed
     * by descriptor id.
     *
     * Five per-knob callbacks used to sit here, each of which had to remember to
     * write the session store *and* forward the value under the right engine name.
     * The id is now the only thing a knob has to get right, and `isTransient` — the
     * flag `RotaryKnob` has always passed and every one of those callbacks silently
     * dropped — reaches the use case that decides preview from commit.
     */
    onParamChange: (paramId: CrumbsPersistedParamId, value: number, isTransient?: boolean) => void;
    /**
     * Same gesture contract as {@link CrumbsControlsProps.onParamChange}: the
     * three voice-stack ids are declared descriptor parameters too, so a drag
     * has to preview and a release has to commit. Dropping the flag here is what
     * made these three the last knobs whose every pointer sample would have been
     * its own undo entry.
     */
    onStackChange?: (updates: Partial<VoiceStackParams>, isTransient?: boolean) => void;
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
    onChange: (value: number, isTransient?: boolean) => void;
    readout: string;
}): ReactElement => (
    <Stack align="center" gap={1}>
        <RotaryKnob
            value={value}
            onChange={onChange}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            tone="lavender"
            aria-label={label}
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{readout}</div>
        </div>
    </Stack>
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
    onParamChange,
    onStackChange,
}: CrumbsControlsProps): ReactElement => {
    let panReadout = 'C';
    if (pan < 0) {
        panReadout = `L${Math.abs(Math.round(pan * 100))}`;
    } else if (pan > 0) {
        panReadout = `R${Math.round(pan * 100)}`;
    }

    return (
        <Stack gap={4}>
            {/* Mode switcher */}
            <Row gap={1.5}>
                {MODES.map((m) => (
                    <DawPluginChip
                        key={m}
                        active={mode === m}
                        tone="lavender"
                        size="sm"
                        onClick={() => onModeChange(m)}
                    >
                        {m.charAt(0).toUpperCase() + m.slice(1)}
                    </DawPluginChip>
                ))}
            </Row>

            {/* Envelope */}
            <div>
                <div className="mb-2 text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">Envelope</div>
                <div className="grid grid-cols-5 gap-x-2 gap-y-3">
                    <Knob
                        value={envelope.attack}
                        onChange={(v, isTransient) => onParamChange('attack', v, isTransient)}
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
                        onChange={(v, isTransient) => onParamChange('hold', v, isTransient)}
                        label="Hold"
                        min={0}
                        max={2}
                        step={0.001}
                        defaultValue={0}
                        readout={`${(envelope.hold * 1000).toFixed(0)}ms`}
                    />
                    <Knob
                        value={envelope.decay}
                        onChange={(v, isTransient) => onParamChange('decay', v, isTransient)}
                        label="Dec"
                        min={0.001}
                        max={5}
                        step={0.001}
                        defaultValue={0.3}
                        readout={`${envelope.decay.toFixed(2)}s`}
                    />
                    <Knob
                        value={envelope.sustain}
                        onChange={(v, isTransient) => onParamChange('sustain', v, isTransient)}
                        label="Sus"
                        min={0}
                        max={1}
                        step={0.01}
                        defaultValue={1}
                        readout={`${Math.round(envelope.sustain * 100)}%`}
                    />
                    <Knob
                        value={envelope.release}
                        onChange={(v, isTransient) => onParamChange('release', v, isTransient)}
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
                        onChange={(v, isTransient) => onParamChange('filterCutoff', v, isTransient)}
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
                        onChange={(v, isTransient) => onParamChange('filterResonance', v, isTransient)}
                        label="Reso"
                        min={0.5}
                        max={20}
                        step={0.1}
                        defaultValue={1}
                        readout={filterResonance.toFixed(1)}
                    />
                    <Knob
                        value={masterGain}
                        onChange={(v, isTransient) => onParamChange('masterGain', v, isTransient)}
                        label="Gain"
                        min={0}
                        max={2}
                        step={0.01}
                        defaultValue={0.8}
                        readout={`${Math.round(masterGain * 100)}%`}
                    />
                    <Knob
                        value={tune}
                        onChange={(v, isTransient) => onParamChange('tune', v, isTransient)}
                        label="Tune"
                        min={-24}
                        max={24}
                        step={0.1}
                        defaultValue={0}
                        readout={`${tune > 0 ? '+' : ''}${tune.toFixed(1)}st`}
                    />
                    <Knob
                        value={pan}
                        onChange={(v, isTransient) => onParamChange('pan', v, isTransient)}
                        label="Pan"
                        min={-1}
                        max={1}
                        step={0.01}
                        defaultValue={0}
                        readout={panReadout}
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
                            onChange={(v, isTransient) => onStackChange({ stackCount: Math.round(v) }, isTransient)}
                            label="Voices"
                            min={1}
                            max={8}
                            step={1}
                            defaultValue={1}
                            readout={`${voiceStack.stackCount}`}
                        />
                        <Knob
                            value={voiceStack.detuneSpread}
                            onChange={(v, isTransient) => onStackChange({ detuneSpread: v }, isTransient)}
                            label="Detune"
                            min={0}
                            max={100}
                            step={0.5}
                            defaultValue={0}
                            readout={`${voiceStack.detuneSpread.toFixed(1)}¢`}
                        />
                        <Knob
                            value={voiceStack.stackSpread}
                            onChange={(v, isTransient) => onStackChange({ stackSpread: v }, isTransient)}
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
        </Stack>
    );
};
