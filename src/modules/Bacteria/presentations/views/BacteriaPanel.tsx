/**
 * Bacteria — creative multi-effects framework panel.
 *
 * 5-level progressive disclosure:
 *   Level 1 (Play): Preset browser, 8 macros, XY morph pad, master mix
 *   Level 2 (Shape): Selected module's core params + quick modulators
 *   Level 3 (Build): Multi-band crossover, per-band chains, modulation dock
 *   Level 4 (Route): Signal flow DAG, routing mode toggles
 *   Level 5 (Lab): Waveshaper editor, Bezier LFO, spectral bin editor
 */
import { type ReactElement, useSyncExternalStore } from 'react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import {
    bacteriaStore,
    type BacteriaState,
    type BacteriaUiLevel,
    setBacteriaUiLevel,
    setBacteriaActiveBand,
    setBacteriaActiveModule,
} from '../../stores/bacteriaStore';
import { setBacteriaParamWithAudio, setBacteriaBandParamWithAudio } from '../../useCases/bacteriaParamBridge';
import { BACTERIA_PRESETS } from '../../useCases/bacteriaPresets';
import { loadBacteriaPatch } from '../../stores/bacteriaStore';
import { XYMorphPad } from '../components/XYMorphPad';
import { CrossoverDisplay } from '../components/CrossoverDisplay';
import { BandStrip } from '../components/BandStrip';
import { WaveshaperEditor } from '../components/WaveshaperEditor';
import { BezierLfoEditor } from '../components/BezierLfoEditor';
import { SpectralBinEditor } from '../components/SpectralBinEditor';
import { StepSequencerEditor } from '../components/StepSequencerEditor';
import { ModulationDock } from '../components/ModulationDock';
import { SpectrumAnalyzer } from '../components/SpectrumAnalyzer';
import { NodeGraphEditor } from '../components/NodeGraphEditor';

const LEVELS: { id: BacteriaUiLevel; label: string; description: string }[] = [
    { id: 1, label: 'Play', description: 'Performance view' },
    { id: 2, label: 'Shape', description: 'Module editing' },
    { id: 3, label: 'Build', description: 'Multi-band + modulation' },
    { id: 4, label: 'Route', description: 'Signal flow' },
    { id: 5, label: 'Lab', description: 'Deep editing' },
];

const EFFECT_MODULES = [
    { id: 'distortion', label: 'Distortion' },
    { id: 'filter', label: 'Filter' },
    { id: 'chorus', label: 'Chorus' },
    { id: 'phaser', label: 'Phaser' },
    { id: 'granular', label: 'Granular' },
    { id: 'spectral', label: 'Spectral' },
    { id: 'freqShift', label: 'Freq Shift' },
    { id: 'lofi', label: 'Lo-Fi' },
    { id: 'convolution', label: 'Body' },
];

const DISTORTION_MODES = [
    'soft-clip',
    'hard-clip',
    'foldback',
    'wavefold',
    'bitcrush',
    'tube',
    'breakdown',
    'smudge',
    'custom',
] as const;
const FILTER_MODES = ['lowpass', 'highpass', 'bandpass', 'notch', 'formant', 'comb'] as const;
const ROUTING_MODES = ['serial', 'parallel', 'mid-side'] as const;

function formatValue(v: number, unit: string): string {
    if (unit === 'dB') {
        return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    }
    if (unit === 'ms') {
        return v < 1 ? `${(v * 1000).toFixed(0)}µs` : v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`;
    }
    if (unit === 'Hz') {
        return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;
    }
    if (unit === '%') {
        return `${v.toFixed(0)}%`;
    }
    if (unit === 'st') {
        return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    }
    return `${v.toFixed(2)}`;
}

const K = ({
    v,
    k,
    label,
    min,
    max,
    step,
    def,
    unit,
    onChangeFn,
}: {
    v: number;
    k: string;
    label: string;
    min: number;
    max: number;
    step: number;
    def: number;
    unit?: string;
    onChangeFn?: (key: string, value: number) => void;
}): ReactElement => (
    <div className="flex flex-col items-center gap-0">
        <RotaryKnob
            value={v}
            onChange={(val) => (onChangeFn ?? setGlobalParam)(k, val)}
            min={min}
            max={max}
            step={step}
            defaultValue={def}
            size="sm"
        />
        <span className="text-[7px] text-muted-foreground leading-none">{label}</span>
        {unit ? <span className="text-[6px] text-muted-foreground/40 font-mono">{formatValue(v, unit)}</span> : null}
    </div>
);

function setGlobalParam(key: string, value: number): void {
    setBacteriaParamWithAudio(key as never, value);
}

// ── Level 1: Play ────────────────────────────────────────────────────────────

const PlayLevel = ({ state }: { state: BacteriaState }): ReactElement => {
    const patch = state.patch;
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden gap-3 p-3">
            {/* Left: XY Morph Pad */}
            <div className="flex flex-col gap-2 shrink-0">
                <XYMorphPad
                    x={patch.morphX}
                    y={patch.morphY}
                    onChangeX={(v) => setGlobalParam('morphX', v)}
                    onChangeY={(v) => setGlobalParam('morphY', v)}
                    snapshots={patch.snapshots}
                    width={200}
                    height={200}
                />
                <K v={patch.mix} k="mix" label="Mix" min={0} max={1} step={0.01} def={1} />
            </div>

            {/* Center: 8 Performance Macros */}
            <div className="flex-1 flex flex-col gap-2">
                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                    Performance Macros
                </div>
                <div className="grid grid-cols-4 gap-3">
                    {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((i) => (
                        <K
                            key={i}
                            v={patch[`macro${i}` as keyof typeof patch] as number}
                            k={`macro${i}`}
                            label={`Macro ${i}`}
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.5}
                        />
                    ))}
                </div>
            </div>

            {/* Right: Preset browser */}
            <div className="flex flex-col gap-2 shrink-0 w-[160px]">
                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">Preset</div>
                <div className="relative">
                    <button
                        type="button"
                        className="flex items-center gap-1 w-full bg-surface-inset border border-border/40 rounded px-2 py-1 text-[10px] text-foreground font-medium cursor-pointer"
                        onClick={() => setPresetMenuOpen(!presetMenuOpen)}
                    >
                        <span className="truncate flex-1 text-left">{patch.name}</span>
                        <ChevronDown className="size-3 text-muted-foreground shrink-0" />
                    </button>
                    {presetMenuOpen ? (
                        <div className="absolute top-full left-0 mt-1 z-50 bg-surface-raised border border-border/40 rounded-md shadow-lg py-0.5 w-full max-h-[200px] overflow-y-auto">
                            {BACTERIA_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={`w-full text-left px-2 py-1 text-[9px] hover:bg-surface-inset transition-colors ${
                                        preset.patch.name === patch.name
                                            ? 'text-foreground font-medium'
                                            : 'text-foreground/70'
                                    }`}
                                    onClick={() => {
                                        loadBacteriaPatch(preset.patch);
                                        setPresetMenuOpen(false);
                                    }}
                                >
                                    <span className="block truncate">{preset.name}</span>
                                    <span className="text-[7px] text-muted-foreground/40">{preset.category}</span>
                                </button>
                            ))}
                        </div>
                    ) : null}
                </div>
                <div className="space-y-1 mt-2">
                    <K
                        v={patch.inputGain}
                        k="inputGain"
                        label="Input"
                        min={-24}
                        max={24}
                        step={0.5}
                        def={0}
                        unit="dB"
                    />
                    <K
                        v={patch.outputGain}
                        k="outputGain"
                        label="Output"
                        min={-24}
                        max={24}
                        step={0.5}
                        def={0}
                        unit="dB"
                    />
                </div>
            </div>
        </div>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const ShapeLevel = ({ state }: { state: BacteriaState }): ReactElement => {
    const patch = state.patch;
    const band = patch.bands[state.activeBand] ?? patch.bands[0]!;
    const bi = state.activeBand;
    const module = state.activeModule;

    const setBP = (key: string, value: number): void => {
        setBacteriaBandParamWithAudio(bi, key as never, value);
    };

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Module selector sidebar */}
            <div className="flex flex-col gap-0.5 p-1.5 shrink-0 border-r border-border/20">
                {EFFECT_MODULES.map((m) => (
                    <button
                        key={m.id}
                        type="button"
                        className={`px-2 py-1 rounded text-[8px] font-medium text-left transition-colors ${
                            module === m.id
                                ? 'bg-rose-500/20 text-rose-300'
                                : 'text-muted-foreground/60 hover:text-foreground hover:bg-surface-raised'
                        }`}
                        onClick={() => setBacteriaActiveModule(m.id)}
                    >
                        {m.label}
                    </button>
                ))}
            </div>

            {/* Module controls */}
            <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {module === 'distortion' ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={band.distortionEnabled}
                                    onChange={(e) => setBP('distortionEnabled', e.target.checked ? 1 : 0)}
                                    className="size-2.5 rounded"
                                    style={{ accentColor: 'rgb(244,63,94)' }}
                                />
                                Enabled
                            </label>
                            <div className="flex gap-0.5">
                                {DISTORTION_MODES.map((mode, i) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                            band.distortionMode === mode
                                                ? 'bg-rose-500 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setBP('distortionMode', i)}
                                    >
                                        {mode.replace('-', ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.drive}
                                k="drive"
                                label="Drive"
                                min={0}
                                max={100}
                                step={1}
                                def={25}
                                unit="%"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.asymmetry}
                                k="asymmetry"
                                label="Asymmetry"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0}
                                onChangeFn={setBP}
                            />
                            {band.distortionMode === 'foldback' ? (
                                <K
                                    v={band.foldbackThreshold}
                                    k="foldbackThreshold"
                                    label="Fold Thresh"
                                    min={0.1}
                                    max={1}
                                    step={0.01}
                                    def={0.7}
                                    onChangeFn={setBP}
                                />
                            ) : null}
                            {band.distortionMode === 'bitcrush' ? (
                                <>
                                    <K
                                        v={band.bitDepth}
                                        k="bitDepth"
                                        label="Bit Depth"
                                        min={1}
                                        max={24}
                                        step={1}
                                        def={16}
                                        onChangeFn={setBP}
                                    />
                                    <K
                                        v={band.sampleRateReduce}
                                        k="sampleRateReduce"
                                        label="SR Reduce"
                                        min={1}
                                        max={64}
                                        step={1}
                                        def={1}
                                        onChangeFn={setBP}
                                    />
                                </>
                            ) : null}
                            {band.distortionMode === 'tube' ? (
                                <K
                                    v={band.tubeBias}
                                    k="tubeBias"
                                    label="Bias"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    def={0.5}
                                    onChangeFn={setBP}
                                />
                            ) : null}
                            {band.distortionMode === 'breakdown' ? (
                                <K
                                    v={band.breakdownDepth}
                                    k="breakdownDepth"
                                    label="Depth"
                                    min={0}
                                    max={4}
                                    step={0.1}
                                    def={1}
                                    unit="st"
                                    onChangeFn={setBP}
                                />
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {module === 'filter' ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={band.filterEnabled}
                                    onChange={(e) => setBP('filterEnabled', e.target.checked ? 1 : 0)}
                                    className="size-2.5 rounded"
                                    style={{ accentColor: 'rgb(244,63,94)' }}
                                />
                                Enabled
                            </label>
                            <div className="flex gap-0.5">
                                {FILTER_MODES.map((mode, i) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={`px-1.5 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                            band.filterMode === mode
                                                ? 'bg-rose-500 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setBP('filterMode', i)}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.filterCutoff}
                                k="filterCutoff"
                                label="Cutoff"
                                min={20}
                                max={20000}
                                step={1}
                                def={8000}
                                unit="Hz"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.filterResonance}
                                k="filterResonance"
                                label="Resonance"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.3}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.filterEnvAmount}
                                k="filterEnvAmount"
                                label="Env Amt"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.filterEnvAttack}
                                k="filterEnvAttack"
                                label="Env Atk"
                                min={0.1}
                                max={500}
                                step={0.1}
                                def={5}
                                unit="ms"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.filterEnvRelease}
                                k="filterEnvRelease"
                                label="Env Rel"
                                min={1}
                                max={5000}
                                step={1}
                                def={200}
                                unit="ms"
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'chorus' ? (
                    <div className="space-y-2">
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={band.chorusEnabled}
                                onChange={(e) => setBP('chorusEnabled', e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(244,63,94)' }}
                            />
                            Enabled
                        </label>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.chorusRate}
                                k="chorusRate"
                                label="Rate"
                                min={0.01}
                                max={20}
                                step={0.01}
                                def={1.5}
                                unit="Hz"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.chorusDepth}
                                k="chorusDepth"
                                label="Depth"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.4}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.chorusFeedback}
                                k="chorusFeedback"
                                label="Feedback"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0.2}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.chorusMix}
                                k="chorusMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'phaser' ? (
                    <div className="space-y-2">
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={band.phaserEnabled}
                                onChange={(e) => setBP('phaserEnabled', e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(244,63,94)' }}
                            />
                            Enabled
                        </label>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.phaserRate}
                                k="phaserRate"
                                label="Rate"
                                min={0.01}
                                max={10}
                                step={0.01}
                                def={0.5}
                                unit="Hz"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.phaserDepth}
                                k="phaserDepth"
                                label="Depth"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.7}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.phaserFeedback}
                                k="phaserFeedback"
                                label="Feedback"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.phaserMix}
                                k="phaserMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'granular' ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={band.granularEnabled}
                                    onChange={(e) => setBP('granularEnabled', e.target.checked ? 1 : 0)}
                                    className="size-2.5 rounded"
                                    style={{ accentColor: 'rgb(244,63,94)' }}
                                />
                                Enabled
                            </label>
                            <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={band.grainFreeze}
                                    onChange={(e) => setBP('grainFreeze', e.target.checked ? 1 : 0)}
                                    className="size-2.5 rounded"
                                    style={{ accentColor: 'rgb(244,63,94)' }}
                                />
                                Freeze
                            </label>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.grainSize}
                                k="grainSize"
                                label="Size"
                                min={10}
                                max={500}
                                step={1}
                                def={80}
                                unit="ms"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.grainDensity}
                                k="grainDensity"
                                label="Density"
                                min={1}
                                max={100}
                                step={1}
                                def={15}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.grainPosOffset}
                                k="grainPosOffset"
                                label="Position"
                                min={0}
                                max={2000}
                                step={1}
                                def={100}
                                unit="ms"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.grainPitch}
                                k="grainPitch"
                                label="Pitch"
                                min={-24}
                                max={24}
                                step={0.1}
                                def={0}
                                unit="st"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.grainMix}
                                k="grainMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'spectral' ? (
                    <div className="space-y-2">
                        <div className="flex items-center gap-2">
                            <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={band.spectralEnabled}
                                    onChange={(e) => setBP('spectralEnabled', e.target.checked ? 1 : 0)}
                                    className="size-2.5 rounded"
                                    style={{ accentColor: 'rgb(244,63,94)' }}
                                />
                                Enabled
                            </label>
                            <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={band.spectralFreeze}
                                    onChange={(e) => setBP('spectralFreeze', e.target.checked ? 1 : 0)}
                                    className="size-2.5 rounded"
                                    style={{ accentColor: 'rgb(244,63,94)' }}
                                />
                                Freeze
                            </label>
                        </div>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.spectralBlur}
                                k="spectralBlur"
                                label="Blur"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.spectralMix}
                                k="spectralMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'freqShift' ? (
                    <div className="space-y-2">
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={band.freqShiftEnabled}
                                onChange={(e) => setBP('freqShiftEnabled', e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(244,63,94)' }}
                            />
                            Enabled
                        </label>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.freqShiftHz}
                                k="freqShiftHz"
                                label="Shift"
                                min={-1000}
                                max={1000}
                                step={0.1}
                                def={0}
                                unit="Hz"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.freqShiftMix}
                                k="freqShiftMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'lofi' ? (
                    <div className="space-y-2">
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={band.lofiEnabled}
                                onChange={(e) => setBP('lofiEnabled', e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(244,63,94)' }}
                            />
                            Enabled
                        </label>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.lofiAmount}
                                k="lofiAmount"
                                label="Amount"
                                min={0}
                                max={100}
                                step={1}
                                def={0}
                                unit="%"
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.codecArtifact}
                                k="codecArtifact"
                                label="Codec"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {module === 'convolution' ? (
                    <div className="space-y-2">
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={band.convolutionEnabled}
                                onChange={(e) => setBP('convolutionEnabled', e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(244,63,94)' }}
                            />
                            Enabled
                        </label>
                        <div className="flex gap-3 flex-wrap">
                            <K
                                v={band.convolutionMix}
                                k="convolutionMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.3}
                                onChangeFn={setBP}
                            />
                            <K
                                v={band.convolutionSeparation}
                                k="convolutionSeparation"
                                label="Separation"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBP}
                            />
                        </div>
                    </div>
                ) : null}

                {/* Quick modulators (LFO + Env follower) */}
                <div className="border-t border-border/20 pt-2 mt-2 space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Quick Modulators
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K
                            v={patch.lfo1Rate}
                            k="lfo1Rate"
                            label="LFO Rate"
                            min={0.01}
                            max={40}
                            step={0.01}
                            def={2}
                            unit="Hz"
                        />
                        <K v={patch.lfo1Amount} k="lfo1Amount" label="LFO Amt" min={0} max={1} step={0.01} def={0.5} />
                        <K
                            v={patch.envFollowerAttack}
                            k="envFollowerAttack"
                            label="Env Atk"
                            min={0.1}
                            max={100}
                            step={0.1}
                            def={5}
                            unit="ms"
                        />
                        <K
                            v={patch.envFollowerRelease}
                            k="envFollowerRelease"
                            label="Env Rel"
                            min={1}
                            max={2000}
                            step={1}
                            def={200}
                            unit="ms"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

const BuildLevel = ({ state }: { state: BacteriaState }): ReactElement => {
    const patch = state.patch;

    return (
        <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {/* Spectrum analyzer with crossover overlay */}
            <div className="shrink-0 px-1 pt-1">
                <SpectrumAnalyzer
                    width={800}
                    height={60}
                    crossoverFreqs={[
                        patch.crossoverFreq1,
                        patch.crossoverFreq2,
                        patch.crossoverFreq3,
                        patch.crossoverFreq4,
                        patch.crossoverFreq5,
                    ]}
                    bandCount={patch.bandCount}
                    activeBand={state.activeBand}
                    showHeatmap
                />
            </div>

            {/* Crossover display */}
            <CrossoverDisplay
                bandCount={patch.bandCount}
                crossoverFreqs={[
                    patch.crossoverFreq1,
                    patch.crossoverFreq2,
                    patch.crossoverFreq3,
                    patch.crossoverFreq4,
                    patch.crossoverFreq5,
                ]}
                crossoverMode={patch.crossoverMode}
                activeBand={state.activeBand}
                onBandSelect={setBacteriaActiveBand}
                onCrossoverChange={(idx, freq) => setGlobalParam(`crossoverFreq${idx + 1}`, freq)}
            />

            {/* Band strips */}
            <div className="flex flex-1 min-h-0 overflow-x-auto gap-0.5 p-1">
                {Array.from({ length: patch.bandCount }, (_, i) => (
                    <BandStrip
                        key={i}
                        index={i}
                        band={patch.bands[i]!}
                        isActive={state.activeBand === i}
                        onSelect={() => setBacteriaActiveBand(i)}
                        onParamChange={(key, value) => setBacteriaBandParamWithAudio(i, key as never, value)}
                    />
                ))}
            </div>

            {/* Band count + crossover controls */}
            <div className="flex items-center gap-3 px-2 py-1 border-t border-border/20">
                <div className="flex items-center gap-1">
                    <span className="text-[7px] text-muted-foreground">Bands:</span>
                    {[1, 2, 3, 4, 5, 6].map((n) => (
                        <button
                            key={n}
                            type="button"
                            className={`w-4 h-4 rounded text-[7px] font-bold transition-colors ${
                                patch.bandCount === n
                                    ? 'bg-rose-500 text-white'
                                    : 'text-muted-foreground/40 hover:text-foreground'
                            }`}
                            onClick={() => setGlobalParam('bandCount', n)}
                        >
                            {n}
                        </button>
                    ))}
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-[7px] text-muted-foreground">Slope:</span>
                    {['12', '24', '36', '48'].map((s, i) => (
                        <button
                            key={s}
                            type="button"
                            className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                patch.crossoverSlope === i
                                    ? 'bg-rose-500 text-white'
                                    : 'text-muted-foreground/40 hover:text-foreground'
                            }`}
                            onClick={() => setGlobalParam('crossoverSlope', i)}
                        >
                            {s}
                        </button>
                    ))}
                    <span className="text-[6px] text-muted-foreground/40">dB/oct</span>
                </div>
                <div className="flex items-center gap-1">
                    <span className="text-[7px] text-muted-foreground">Mode:</span>
                    {['LR4', 'Linear'].map((m, i) => (
                        <button
                            key={m}
                            type="button"
                            className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                patch.crossoverMode === (i === 0 ? 'lr4' : 'linear-phase')
                                    ? 'bg-rose-500 text-white'
                                    : 'text-muted-foreground/40 hover:text-foreground'
                            }`}
                            onClick={() => setGlobalParam('crossoverMode', i)}
                        >
                            {m}
                        </button>
                    ))}
                </div>
                <div className="flex-1" />
                <ModulationDock patch={patch} modValues={[]} onAssignmentAdd={() => {}} onAssignmentRemove={() => {}} />
            </div>
        </div>
    );
};

// ── Level 4: Route ───────────────────────────────────────────────────────────

const RouteLevel = ({ state }: { state: BacteriaState }): ReactElement => {
    const patch = state.patch;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Signal flow DAG editor */}
            <div className="flex-1 p-3">
                <NodeGraphEditor
                    width={600}
                    height={350}
                    bandCount={patch.bandCount}
                    bands={patch.bands}
                    globalRouting={patch.globalRouting}
                    crossoverFreqs={[
                        patch.crossoverFreq1,
                        patch.crossoverFreq2,
                        patch.crossoverFreq3,
                        patch.crossoverFreq4,
                        patch.crossoverFreq5,
                    ]}
                />
            </div>

            {/* Routing controls */}
            <div className="w-[200px] p-2 space-y-3 border-l border-border/20">
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Global Routing
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {ROUTING_MODES.map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                className={`px-2 py-1 rounded text-[8px] font-medium text-left transition-colors ${
                                    patch.globalRouting === mode
                                        ? 'bg-rose-500/20 text-rose-300'
                                        : 'text-muted-foreground/60 hover:text-foreground hover:bg-surface-raised'
                                }`}
                                onClick={() => setGlobalParam('globalRouting', ROUTING_MODES.indexOf(mode))}
                            >
                                {mode === 'serial'
                                    ? 'Serial (A → B → C)'
                                    : mode === 'parallel'
                                      ? 'Parallel (A + B + C)'
                                      : 'Mid/Side (M | S)'}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Per-band routing */}
                {Array.from({ length: patch.bandCount }, (_, i) => (
                    <div key={i} className="space-y-0.5">
                        <div className="text-[7px] text-muted-foreground/40 font-medium">Band {i + 1}</div>
                        <div className="flex gap-0.5">
                            {ROUTING_MODES.map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                        patch.bands[i]?.routingMode === mode
                                            ? 'bg-rose-500 text-white'
                                            : 'text-muted-foreground/40 hover:text-foreground'
                                    }`}
                                    onClick={() =>
                                        setBacteriaBandParamWithAudio(
                                            i,
                                            'routingMode' as never,
                                            ROUTING_MODES.indexOf(mode)
                                        )
                                    }
                                >
                                    {mode.split('-')[0]}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const LabLevel = ({ state }: { state: BacteriaState }): ReactElement => {
    const patch = state.patch;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden p-3 gap-3">
            {/* Advanced modulation sources */}
            <div className="flex-1 space-y-3 overflow-y-auto">
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        LFO 1
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K
                            v={patch.lfo1Rate}
                            k="lfo1Rate"
                            label="Rate"
                            min={0.01}
                            max={40}
                            step={0.01}
                            def={2}
                            unit="Hz"
                        />
                        <K v={patch.lfo1Amount} k="lfo1Amount" label="Amount" min={0} max={1} step={0.01} def={0.5} />
                        <div className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-0.5">
                                {['Sin', 'Tri', 'Saw', 'Sq', 'S&H'].map((s, i) => (
                                    <button
                                        key={s}
                                        type="button"
                                        className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                            patch.lfo1Shape === i
                                                ? 'bg-rose-500 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setGlobalParam('lfo1Shape', i)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[6px] text-muted-foreground leading-none">Shape</span>
                        </div>
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        LFO 2
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K
                            v={patch.lfo2Rate}
                            k="lfo2Rate"
                            label="Rate"
                            min={0.01}
                            max={40}
                            step={0.01}
                            def={0.5}
                            unit="Hz"
                        />
                        <K v={patch.lfo2Amount} k="lfo2Amount" label="Amount" min={0} max={1} step={0.01} def={0.5} />
                        <div className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-0.5">
                                {['Sin', 'Tri', 'Saw', 'Sq', 'S&H'].map((s, i) => (
                                    <button
                                        key={s}
                                        type="button"
                                        className={`px-1 py-0.5 rounded text-[6px] font-medium transition-colors ${
                                            patch.lfo2Shape === i
                                                ? 'bg-rose-500 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setGlobalParam('lfo2Shape', i)}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[6px] text-muted-foreground leading-none">Shape</span>
                        </div>
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Envelope Follower
                    </div>
                    <div className="flex gap-3">
                        <K
                            v={patch.envFollowerAttack}
                            k="envFollowerAttack"
                            label="Attack"
                            min={0.1}
                            max={100}
                            step={0.1}
                            def={5}
                            unit="ms"
                        />
                        <K
                            v={patch.envFollowerRelease}
                            k="envFollowerRelease"
                            label="Release"
                            min={1}
                            max={2000}
                            step={1}
                            def={200}
                            unit="ms"
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Lorenz Attractor
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K v={patch.lorenzSigma} k="lorenzSigma" label="Sigma" min={1} max={30} step={0.1} def={10} />
                        <K v={patch.lorenzRho} k="lorenzRho" label="Rho" min={1} max={50} step={0.1} def={28} />
                        <K
                            v={patch.lorenzBeta}
                            k="lorenzBeta"
                            label="Beta"
                            min={0.1}
                            max={10}
                            step={0.01}
                            def={2.667}
                        />
                        <K
                            v={patch.lorenzSpeed}
                            k="lorenzSpeed"
                            label="Speed"
                            min={0.01}
                            max={10}
                            step={0.01}
                            def={1}
                        />
                    </div>
                </div>

                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Step Sequencer
                    </div>
                    <div className="flex gap-3">
                        <K v={patch.stepSeqSteps} k="stepSeqSteps" label="Steps" min={1} max={32} step={1} def={16} />
                        <K
                            v={patch.stepSeqRate}
                            k="stepSeqRate"
                            label="Rate"
                            min={0.5}
                            max={32}
                            step={0.5}
                            def={4}
                            unit="Hz"
                        />
                    </div>
                </div>
            </div>

            {/* Custom editors */}
            <div className="w-[320px] shrink-0 flex flex-col gap-2 overflow-y-auto">
                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                    Custom Waveshaper
                </div>
                <WaveshaperEditor width={300} height={180} segments={[]} onSegmentsChange={() => {}} />

                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider mt-1">
                    Bezier LFO
                </div>
                <BezierLfoEditor width={300} height={120} points={[]} onPointsChange={() => {}} gridDivisions={8} />

                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider mt-1">
                    Step Sequencer
                </div>
                <StepSequencerEditor
                    width={300}
                    height={80}
                    steps={[]}
                    numSteps={patch.stepSeqSteps}
                    onStepsChange={() => {}}
                />

                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider mt-1">
                    Spectral Bin Gate
                </div>
                <SpectralBinEditor width={300} height={100} binValues={[]} onBinValuesChange={() => {}} mode="gate" />
            </div>
        </div>
    );
};

// ── Main Panel ───────────────────────────────────────────────────────────────

export const BacteriaPanel = (): ReactElement => {
    const state = useSyncExternalStore<BacteriaState | null>(
        (cb) => bacteriaStore.subscribe(cb),
        () => bacteriaStore.value
    );

    if (!state) {
        return <div className="flex items-center justify-center h-full text-muted-foreground">Loading...</div>;
    }

    return (
        <div className="flex flex-col h-full">
            {/* ─── Top bar: level selector ─── */}
            <div
                className="flex items-center gap-2 px-2 py-1 shrink-0"
                style={{
                    background: 'linear-gradient(180deg, rgba(20,20,22,0.95) 0%, rgba(14,14,16,0.95) 100%)',
                    boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.04), 0 1px 3px rgba(0,0,0,0.5)',
                    borderBottom: '1px solid rgba(0,0,0,0.4)',
                }}
            >
                {/* Level tabs */}
                <div className="flex gap-0.5">
                    {LEVELS.map((level) => (
                        <button
                            key={level.id}
                            type="button"
                            className={`flex items-center gap-1 px-2.5 py-0.5 rounded text-[9px] font-medium transition-all ${
                                state.uiLevel === level.id
                                    ? 'bg-rose-500 text-white'
                                    : 'text-muted-foreground/60 hover:text-foreground'
                            }`}
                            onClick={() => setBacteriaUiLevel(level.id)}
                            title={level.description}
                        >
                            {level.label}
                        </button>
                    ))}
                </div>

                <div
                    className="w-px h-4 shrink-0"
                    style={{
                        background: 'linear-gradient(180deg, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.01) 100%)',
                    }}
                />

                {/* Band selector (visible at Level 2+) */}
                {state.uiLevel >= 2 ? (
                    <div className="flex items-center gap-1">
                        <span className="text-[7px] text-muted-foreground/40">Band:</span>
                        {Array.from({ length: state.patch.bandCount }, (_, i) => (
                            <button
                                key={i}
                                type="button"
                                className={`w-4 h-4 rounded text-[7px] font-bold transition-colors ${
                                    state.activeBand === i
                                        ? 'bg-rose-500 text-white'
                                        : 'text-muted-foreground/40 hover:text-foreground'
                                }`}
                                onClick={() => setBacteriaActiveBand(i)}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                ) : null}

                <div className="flex-1" />

                {/* Master mix + bypass */}
                <div className="flex items-center gap-2">
                    <span className="text-[7px] text-muted-foreground/40 font-mono">
                        In: {formatValue(state.inputDb, 'dB')} / Out: {formatValue(state.outputDb, 'dB')}
                    </span>
                    {state.latency > 0 ? (
                        <span className="text-[7px] text-muted-foreground/30 font-mono">Lat: {state.latency} smp</span>
                    ) : null}
                </div>
            </div>

            {/* ─── Level content ─── */}
            {state.uiLevel === 1 ? <PlayLevel state={state} /> : null}
            {state.uiLevel === 2 ? <ShapeLevel state={state} /> : null}
            {state.uiLevel === 3 ? <BuildLevel state={state} /> : null}
            {state.uiLevel === 4 ? <RouteLevel state={state} /> : null}
            {state.uiLevel === 5 ? <LabLevel state={state} /> : null}
        </div>
    );
};
