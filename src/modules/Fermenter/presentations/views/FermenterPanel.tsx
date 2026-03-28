/**
 * Fermenter — synth editor panel, rendered inside the bottom dock.
 *
 * Progressive disclosure:
 *   Level 1 (Play) — macros + oscilloscope + meter
 *   Level 2 (Shape) — full synth controls
 */
import { type ReactElement, useSyncExternalStore } from 'react';
import { Cpu } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { ScrollArea } from '#/components/ui/scroll-area';
import {
    fermenterStore,
    setFermenterUiLevel,
    type FermenterState,
} from '../../stores/fermenterStore';
import { type FermenterPatch } from '../../models/FermenterPatch';
import { setFermenterParamWithAudio } from '../../useCases/fermenterParamBridge';
import { MacroStrip } from '../components/MacroStrip';
import { OscillatorSection } from '../components/OscillatorSection';
import { FilterSection } from '../components/FilterSection';
import { EnvelopeSection } from '../components/EnvelopeSection';
import { UnisonSection } from '../components/UnisonSection';
import { EffectsSection } from '../components/EffectsSection';
import { LfoSection } from '../components/LfoSection';
import { Oscilloscope } from '../components/Oscilloscope';
import { OutputMeter } from '../components/OutputMeter';

export const FermenterPanel = (): ReactElement => {
    const state = useSyncExternalStore<FermenterState | null>(
        (cb) => fermenterStore.subscribe(cb),
        () => fermenterStore.value
    );

    const patch = state?.patch ?? fermenterStore.value!.patch;
    const uiLevel = state?.uiLevel ?? 2;
    const activeVoices = state?.activeVoices ?? 0;
    const peakL = state?.peakL ?? 0;
    const peakR = state?.peakR ?? 0;
    const scopeBuffer = state?.scopeBuffer ?? null;

    const setParam = (key: keyof FermenterPatch, value: number): void => {
        setFermenterParamWithAudio(key, value);
    };

    const onParam = (key: string, value: number): void => {
        setFermenterParamWithAudio(key as keyof FermenterPatch, value);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-1 shrink-0 border-b border-border/20">
                <div className="flex items-center gap-3">
                    {/* Level switcher */}
                    <div className="flex gap-0.5 bg-surface-base/50 rounded p-0.5">
                        {([1, 2] as const).map((lvl) => (
                            <button
                                key={lvl}
                                type="button"
                                className={`px-2 py-0.5 rounded text-[9px] font-medium transition-colors ${
                                    uiLevel === lvl
                                        ? 'bg-[var(--color-accent-lavender)] text-white'
                                        : 'text-muted-foreground hover:text-foreground'
                                }`}
                                onClick={() => setFermenterUiLevel(lvl)}
                            >
                                {lvl === 1 ? 'Play' : 'Shape'}
                            </button>
                        ))}
                    </div>

                    {/* Voice / CPU */}
                    <div className="flex items-center gap-1 text-[9px] text-muted-foreground">
                        <Cpu className="size-3" />
                        <span>{String(activeVoices)} voices</span>
                    </div>

                    {/* Oscilloscope */}
                    <Oscilloscope buffer={scopeBuffer} width={120} height={28} />
                </div>

                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground">{patch.name}</span>
                    <OutputMeter peakL={peakL} peakR={peakR} height={28} />
                </div>
            </div>

            {/* Macro strip — always visible */}
            <MacroStrip
                values={patch.macros}
                onChange={(i, v) => {
                    const macros = [...patch.macros] as [number, number, number, number, number, number, number, number];
                    macros[i] = v;
                    setParam('macros', macros as unknown as number);
                }}
            />

            {/* Level 2: Shape — full synth controls */}
            {uiLevel >= 2 ? (
                <ScrollArea className="flex-1 min-h-0">
                    <div className="flex gap-4 p-3">
                        {/* Column 1: Oscillator + Unison */}
                        <div className="w-[260px] shrink-0 space-y-3">
                            <OscillatorSection
                                engine={patch.oscEngine}
                                waveform={patch.oscWaveform}
                                level={patch.oscLevel}
                                coarse={patch.oscCoarse}
                                fine={patch.oscFine}
                                pulseWidth={patch.pulseWidth}
                                noiseLevel={patch.noiseLevel}
                                noiseColor={patch.noiseColor}
                                onEngineChange={(v) => setParam('oscEngine', v)}
                                onWaveformChange={(wf) => setParam('oscWaveform', wf)}
                                onLevelChange={(v) => setParam('oscLevel', v)}
                                onCoarseChange={(v) => setParam('oscCoarse', v)}
                                onFineChange={(v) => setParam('oscFine', v)}
                                onPulseWidthChange={(v) => setParam('pulseWidth', v)}
                                onNoiseLevelChange={(v) => setParam('noiseLevel', v)}
                                onNoiseColorChange={(v) => setParam('noiseColor', v)}
                            />
                            <UnisonSection
                                voices={patch.unisonVoices}
                                detune={patch.unisonDetune}
                                spread={patch.unisonSpread}
                                onVoicesChange={(v) => setParam('unisonVoices', v)}
                                onDetuneChange={(v) => setParam('unisonDetune', v)}
                                onSpreadChange={(v) => setParam('unisonSpread', v)}
                            />
                        </div>

                        {/* Column 2: Filter */}
                        <div className="w-[240px] shrink-0">
                            <FilterSection
                                cutoff={patch.filterCutoff}
                                resonance={patch.filterResonance}
                                mode={patch.filterMode}
                                envAmount={patch.filterEnvAmount}
                                drive={patch.filterDrive}
                                keytrack={patch.filterKeytrack}
                                onCutoffChange={(v) => setParam('filterCutoff', v)}
                                onResonanceChange={(v) => setParam('filterResonance', v)}
                                onModeChange={(v) => setParam('filterMode', v)}
                                onEnvAmountChange={(v) => setParam('filterEnvAmount', v)}
                                onDriveChange={(v) => setParam('filterDrive', v)}
                                onKeytrackChange={(v) => setParam('filterKeytrack', v)}
                            />
                        </div>

                        {/* Column 3: Envelopes */}
                        <div className="w-[260px] shrink-0">
                            <EnvelopeSection
                                ampA={patch.ampAttack} ampD={patch.ampDecay}
                                ampS={patch.ampSustain} ampR={patch.ampRelease}
                                filterA={patch.filterAttack} filterD={patch.filterDecay}
                                filterS={patch.filterSustain} filterR={patch.filterRelease}
                                onAmpChange={(key, v) => setParam(key, v)}
                                onFilterChange={(key, v) => setParam(key, v)}
                            />
                        </div>

                        {/* Column 4: LFO + Portamento */}
                        <div className="w-[200px] shrink-0 space-y-3">
                            <LfoSection
                                rate={patch.lfoRate}
                                shape={patch.lfoShape}
                                pitchAmount={patch.lfoPitchAmount}
                                filterAmount={patch.lfoFilterAmount}
                                onRateChange={(v) => setParam('lfoRate', v)}
                                onShapeChange={(v) => setParam('lfoShape', v)}
                                onPitchAmountChange={(v) => setParam('lfoPitchAmount', v)}
                                onFilterAmountChange={(v) => setParam('lfoFilterAmount', v)}
                            />

                            {/* Portamento */}
                            <div className="space-y-1">
                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider px-1">
                                    Glide
                                </div>
                                <div className="flex items-end gap-2 px-1">
                                    <div className="flex flex-col items-center gap-0.5">
                                        <RotaryKnob
                                            value={patch.portamentoTime} onChange={(v) => setParam('portamentoTime', v)}
                                            min={0} max={2} step={0.01} defaultValue={0} size="lg"
                                        />
                                        <span className="text-[8px] text-muted-foreground">Time</span>
                                        <span className="text-[7px] text-muted-foreground/60 font-mono">
                                            {patch.portamentoTime === 0 ? 'Off' : `${(patch.portamentoTime * 1000).toFixed(0)}ms`}
                                        </span>
                                    </div>
                                    <div className="flex gap-0.5 pb-1">
                                        {['Always', 'Legato'].map((name, i) => (
                                            <button
                                                key={name}
                                                type="button"
                                                className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${
                                                    patch.portamentoMode === i
                                                        ? 'bg-muted text-foreground'
                                                        : 'text-muted-foreground/50 hover:text-foreground'
                                                }`}
                                                onClick={() => setParam('portamentoMode', i)}
                                            >
                                                {name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Column 5: Effects */}
                        <div className="w-[160px] shrink-0">
                            <EffectsSection
                                reverbMix={patch.reverbMix}
                                reverbDecay={patch.reverbDecay}
                                delayTime={patch.delayTime}
                                delayFeedback={patch.delayFeedback}
                                delayMix={patch.delayMix}
                                chorusRate={patch.chorusRate}
                                chorusDepth={patch.chorusDepth}
                                chorusMix={patch.chorusMix}
                                masterGain={patch.masterGain}
                                onParam={onParam}
                            />
                        </div>
                    </div>
                </ScrollArea>
            ) : null}
        </div>
    );
};
