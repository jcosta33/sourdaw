import { type ReactElement, useState, useSyncExternalStore, useTransition } from 'react';
import { Search } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import {
    bacteriaStore,
    type BacteriaState,
    type BacteriaUiLevel,
    setBacteriaActiveBand,
    setBacteriaActiveModule,
    setBacteriaUiLevel,
} from '../../stores/bacteriaStore';
import {
    loadBacteriaPatchWithAudio,
    setBacteriaBandParamWithAudio,
    setBacteriaParamWithAudio,
    type BacteriaPatch,
} from '../../useCases/bacteriaParamBridge';
import { BACTERIA_PRESETS } from '../../useCases/bacteriaPresets';
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

const LEVELS: Array<{ id: BacteriaUiLevel; label: string; eyebrow: string; description: string }> = [
    { id: 1, label: 'Play', eyebrow: 'Morph floor', description: 'Macros, presets, and the petri pad.' },
    { id: 2, label: 'Shape', eyebrow: 'Mutation deck', description: 'One band, one module, all the weirdness.' },
    { id: 3, label: 'Build', eyebrow: 'Band broth', description: 'Split the signal and grow it sideways.' },
    { id: 4, label: 'Route', eyebrow: 'Dish map', description: 'See how the organism is wired.' },
    { id: 5, label: 'Lab', eyebrow: 'Bench', description: 'Curves, bins, and modulation plumbing.' },
];

const EFFECT_MODULES = [
    { id: 'distortion', label: 'Drive', hint: 'Clip, fold, or scrape the active band.' },
    { id: 'filter', label: 'Filter', hint: 'Tilt the broth with resonant cuts.' },
    { id: 'chorus', label: 'Chorus', hint: 'Spread and sway the band.' },
    { id: 'phaser', label: 'Phaser', hint: 'Sweep notches through the smear.' },
    { id: 'granular', label: 'Granular', hint: 'Shred the input into grains.' },
    { id: 'spectral', label: 'Spectral', hint: 'Blur the spectrum into fog.' },
    { id: 'freqShift', label: 'Shift', hint: 'Offset partials off the center line.' },
    { id: 'lofi', label: 'Lo-Fi', hint: 'Crunch codec edges and clock scars.' },
    { id: 'convolution', label: 'Body', hint: 'Inject resonance and strange space.' },
] as const;

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
        if (v < 1) {
            return `${(v * 1000).toFixed(0)}µs`;
        }

        if (v >= 1000) {
            return `${(v / 1000).toFixed(1)}s`;
        }

        return `${v.toFixed(0)}ms`;
    }
    if (unit === 'Hz') {
        if (v >= 1000) {
            return `${(v / 1000).toFixed(1)}k`;
        }

        return `${v.toFixed(0)}`;
    }
    if (unit === '%') {
        return `${v.toFixed(0)}%`;
    }
    if (unit === 'st') {
        return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    }

    return `${v.toFixed(2)}`;
}

function countEnabledEffects(band: BacteriaPatch['bands'][0]): number {
    const flags = [
        band.distortionEnabled,
        band.filterEnabled,
        band.granularEnabled,
        band.spectralEnabled,
        band.modulationEnabled,
        band.convolutionEnabled,
        band.freqShiftEnabled,
        band.chorusEnabled,
        band.phaserEnabled,
        band.lofiEnabled,
    ];

    return flags.filter(Boolean).length;
}

function getPresetCategories(): string[] {
    const categories = ['All', ...new Set(BACTERIA_PRESETS.map((preset) => preset.category))];
    return categories;
}

function getActiveLevel(level: BacteriaUiLevel) {
    const activeLevel = LEVELS.find((candidate) => candidate.id === level);
    if (activeLevel) {
        return activeLevel;
    }

    return LEVELS[0]!;
}

function getModuleMeta(moduleId: string) {
    const moduleMeta = EFFECT_MODULES.find((module) => module.id === moduleId);
    if (moduleMeta) {
        return moduleMeta;
    }

    return EFFECT_MODULES[0]!;
}

function setGlobalParam<K extends keyof BacteriaPatch>(key: K, value: BacteriaPatch[K]): void {
    setBacteriaParamWithAudio(key, value);
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
    <div className="flex min-w-[58px] flex-col items-center gap-1">
        <RotaryKnob
            value={v}
            onChange={(val: number) =>
                (onChangeFn ?? ((key, value) => setGlobalParam(key as keyof BacteriaPatch, value as never)))(k, val)
            }
            min={min}
            max={max}
            step={step}
            defaultValue={def}
            size="sm"
        />
        <span className="text-[8px] leading-none text-muted-foreground">{label}</span>
        {unit ? <span className="font-mono text-[7px] text-muted-foreground/45">{formatValue(v, unit)}</span> : null}
    </div>
);

const SectionHeader = ({
    eyebrow,
    title,
    description,
    detail,
}: {
    eyebrow: string;
    title: string;
    description: string;
    detail?: string;
}): ReactElement => (
    <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
            <div className="text-[8px] font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]/70">
                {eyebrow}
            </div>
            <div className="text-[13px] font-semibold tracking-[0.02em] text-foreground">{title}</div>
            <span className="sr-only">{description}</span>
        </div>
        {detail ? <div className="bacteria-led shrink-0">{detail}</div> : null}
    </div>
);

const MetricCell = ({ label, value }: { label: string; value: string }): ReactElement => (
    <div className="bacteria-window flex min-w-[92px] flex-col gap-1 px-3 py-2">
        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">{label}</span>
        <span className="font-mono text-[12px] text-foreground">{value}</span>
    </div>
);

const BandMeters = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="bacteria-window flex flex-col gap-2 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
            <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">Band energy</span>
            <span className="text-[8px] text-muted-foreground/45">{state.patch.bandCount} active lanes</span>
        </div>
        <div className="flex gap-2">
            {Array.from({ length: state.patch.bandCount }, (_, index) => {
                const level = Math.max(0, Math.min(1, ((state.bandLevels[index] ?? -60) + 60) / 60));
                return (
                    <div key={index} className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="h-2 overflow-hidden rounded-full bg-black/40">
                            <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent-mint),var(--color-accent-cyan),var(--color-accent-lavender))]"
                                style={{ width: `${Math.max(6, level * 100)}%` }}
                            />
                        </div>
                        <div className="flex items-center justify-between gap-2 text-[8px] text-muted-foreground/45">
                            <span>B{index + 1}</span>
                            <span className="font-mono">{formatValue(state.bandLevels[index] ?? -100, 'dB')}</span>
                        </div>
                    </div>
                );
            })}
        </div>
    </div>
);

const PresetRail = ({
    state,
    query,
    category,
    onQueryChange,
    onCategoryChange,
}: {
    state: BacteriaState;
    query: string;
    category: string;
    onQueryChange: (value: string) => void;
    onCategoryChange: (value: string) => void;
}): ReactElement => {
    const categories = getPresetCategories();
    const filteredPresets = BACTERIA_PRESETS.filter((preset) => {
        const matchesCategory = category === 'All' ? true : preset.category === category;
        const normalizedQuery = query.trim().toLowerCase();
        const matchesQuery =
            normalizedQuery.length === 0
                ? true
                : preset.name.toLowerCase().includes(normalizedQuery) ||
                  preset.category.toLowerCase().includes(normalizedQuery);

        return matchesCategory && matchesQuery;
    });
    const activeBand = state.patch.bands[state.activeBand] ?? state.patch.bands[0]!;

    return (
        <aside className="bacteria-window flex h-full w-[248px] shrink-0 flex-col gap-2.5 overflow-hidden p-2.5">
            <SectionHeader
                eyebrow="Presets"
                title="Cultures"
                description="Search the jars, filter the mess, and load a starting organism."
                detail={`${filteredPresets.length} shown`}
            />

            <div className="bacteria-window flex items-center gap-2 px-3 py-2">
                <Search className="size-3.5 shrink-0 text-muted-foreground/55" />
                <label htmlFor="bacteria-preset-search" className="sr-only">
                    Search Bacteria presets
                </label>
                <input
                    id="bacteria-preset-search"
                    type="search"
                    value={query}
                    onChange={(event) => onQueryChange(event.target.value)}
                    placeholder="Search cultures"
                    className="w-full bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/45"
                />
            </div>

            <div className="flex flex-wrap gap-1">
                {categories.map((entry) => {
                    const isActive = category === entry;

                    return (
                        <button
                            key={entry}
                            type="button"
                            className={`bacteria-chip ${isActive ? 'bacteria-chip-active' : ''}`}
                            onClick={() => onCategoryChange(entry)}
                        >
                            {entry}
                        </button>
                    );
                })}
            </div>

            <div className="bacteria-window flex min-h-0 flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between gap-2 border-b border-white/6 px-3 py-2">
                    <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                        Preset drawer
                    </span>
                    <span className="text-[8px] text-muted-foreground/45">{state.patch.name}</span>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-2">
                    {filteredPresets.length > 0 ? (
                        filteredPresets.map((preset) => {
                            const active = preset.patch.name === state.patch.name;

                            return (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={`bacteria-window flex w-full flex-col items-start gap-1 px-3 py-2 text-left ${
                                        active ? 'border-[var(--color-accent-cyan)]/35' : ''
                                    }`}
                                    onClick={() => loadBacteriaPatchWithAudio(preset.patch)}
                                >
                                    <span className="text-[11px] font-medium text-foreground">{preset.name}</span>
                                    <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">
                                        {preset.category}
                                    </span>
                                </button>
                            );
                        })
                    ) : (
                        <div className="flex h-full items-center justify-center px-4 text-center text-[11px] text-muted-foreground">
                            Nothing matches that jar label yet.
                        </div>
                    )}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <MetricCell label="Bands" value={`${state.patch.bandCount}`} />
                <MetricCell label="Routing" value={state.patch.globalRouting.replace('-', '/')} />
                <MetricCell label="Active FX" value={`${countEnabledEffects(activeBand)}`} />
                <MetricCell label="Mix" value={formatValue(state.patch.mix * 100, '%')} />
            </div>
        </aside>
    );
};

const PlayHero = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="grid h-full min-h-0 grid-cols-[minmax(250px,0.92fr)_minmax(0,1.2fr)] gap-2.5 p-2.5">
        <div className="bacteria-window flex min-h-0 flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Petri pad"
                title="Morph field"
                description="Drag the crosshair and smear the patch between the four snapshot corners."
                detail="A/B/C/D"
            />
            <div className="flex flex-1 items-center justify-center">
                <XYMorphPad
                    x={state.patch.morphX}
                    y={state.patch.morphY}
                    onChangeX={(value) => setGlobalParam('morphX', value)}
                    onChangeY={(value) => setGlobalParam('morphY', value)}
                    snapshots={state.patch.snapshots}
                    width={264}
                    height={212}
                />
            </div>
            <div className="grid grid-cols-4 gap-2">
                {state.patch.snapshots.slice(0, 4).map((snapshot) => (
                    <div key={snapshot.id} className="bacteria-window flex flex-col gap-1 px-3 py-2">
                        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                            Snap {snapshot.id}
                        </span>
                        <span className="truncate text-[11px] text-foreground">{snapshot.name}</span>
                    </div>
                ))}
            </div>
        </div>

        <div className="flex min-h-0 flex-col gap-2.5">
            <div className="bacteria-window flex flex-col gap-3 p-3">
                <SectionHeader
                    eyebrow="Quick read"
                    title="Current broth"
                    description="The analyzer and split map stay visible so the patch never feels like a blind box."
                    detail={state.patch.globalRouting.replace('-', ' ')}
                />
                <SpectrumAnalyzer
                    width={560}
                    height={86}
                    crossoverFreqs={[
                        state.patch.crossoverFreq1,
                        state.patch.crossoverFreq2,
                        state.patch.crossoverFreq3,
                        state.patch.crossoverFreq4,
                        state.patch.crossoverFreq5,
                    ]}
                    bandCount={state.patch.bandCount}
                    activeBand={state.activeBand}
                    showHeatmap
                />
                <CrossoverDisplay
                    bandCount={state.patch.bandCount}
                    crossoverFreqs={[
                        state.patch.crossoverFreq1,
                        state.patch.crossoverFreq2,
                        state.patch.crossoverFreq3,
                        state.patch.crossoverFreq4,
                        state.patch.crossoverFreq5,
                    ]}
                    crossoverMode={state.patch.crossoverMode}
                    activeBand={state.activeBand}
                    onBandSelect={setBacteriaActiveBand}
                    onCrossoverChange={(index, freq) =>
                        setGlobalParam(`crossoverFreq${index + 1}` as keyof BacteriaPatch, freq as never)
                    }
                />
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-2 gap-2.5">
                <div className="bacteria-window flex flex-col gap-3 p-3">
                    <SectionHeader
                        eyebrow="Input"
                        title="Gain staging"
                        description="Keep the organism fed, not flooded."
                    />
                    <div className="flex flex-wrap gap-4">
                        <K
                            v={state.patch.inputGain}
                            k="inputGain"
                            label="Input"
                            min={-24}
                            max={24}
                            step={0.5}
                            def={0}
                            unit="dB"
                        />
                        <K
                            v={state.patch.outputGain}
                            k="outputGain"
                            label="Output"
                            min={-24}
                            max={24}
                            step={0.5}
                            def={0}
                            unit="dB"
                        />
                        <K v={state.patch.mix} k="mix" label="Mix" min={0} max={1} step={0.01} def={1} />
                    </div>
                </div>
                <BandMeters state={state} />
            </div>
        </div>
    </div>
);

const PlayDeck = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-2.5">
        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Macros"
                title="Performance cluster"
                description="Eight knobs for pushing the patch around without diving into the microscope."
                detail="8 slots"
            />
            <div className="grid grid-cols-4 gap-x-2 gap-y-4">
                {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((index) => (
                    <K
                        key={index}
                        v={state.patch[`macro${index}` as keyof BacteriaPatch] as number}
                        k={`macro${index}`}
                        label={`Macro ${index}`}
                        min={0}
                        max={1}
                        step={0.01}
                        def={0.5}
                    />
                ))}
            </div>
        </div>

        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Morph"
                title="Crosshair offsets"
                description="Fine-tune the resting position without dragging the pad."
            />
            <div className="flex flex-wrap gap-4">
                <K v={state.patch.morphX} k="morphX" label="X" min={0} max={1} step={0.01} def={0.5} />
                <K v={state.patch.morphY} k="morphY" label="Y" min={0} max={1} step={0.01} def={0.5} />
            </div>
        </div>
    </div>
);

const ShapeHero = ({ state }: { state: BacteriaState }): ReactElement => {
    const moduleMeta = getModuleMeta(state.activeModule);

    return (
        <div className="flex h-full min-h-0 flex-col gap-2.5 p-2.5">
            <div className="bacteria-window flex flex-col gap-3 p-3">
                <SectionHeader
                    eyebrow="Mutation deck"
                    title={moduleMeta.label}
                    description={moduleMeta.hint}
                    detail={`Band ${state.activeBand + 1}`}
                />
                <SpectrumAnalyzer
                    width={560}
                    height={88}
                    crossoverFreqs={[
                        state.patch.crossoverFreq1,
                        state.patch.crossoverFreq2,
                        state.patch.crossoverFreq3,
                        state.patch.crossoverFreq4,
                        state.patch.crossoverFreq5,
                    ]}
                    bandCount={state.patch.bandCount}
                    activeBand={state.activeBand}
                    showHeatmap
                />
                <CrossoverDisplay
                    bandCount={state.patch.bandCount}
                    crossoverFreqs={[
                        state.patch.crossoverFreq1,
                        state.patch.crossoverFreq2,
                        state.patch.crossoverFreq3,
                        state.patch.crossoverFreq4,
                        state.patch.crossoverFreq5,
                    ]}
                    crossoverMode={state.patch.crossoverMode}
                    activeBand={state.activeBand}
                    onBandSelect={setBacteriaActiveBand}
                    onCrossoverChange={(index, freq) =>
                        setGlobalParam(`crossoverFreq${index + 1}` as keyof BacteriaPatch, freq as never)
                    }
                />
            </div>

            <div className="bacteria-window flex min-h-0 flex-1 flex-col gap-3 p-3">
                <div className="flex items-center justify-between gap-3">
                    <div>
                        <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                            Band broth
                        </div>
                        <div className="text-[12px] font-medium text-foreground">Zoomed strips</div>
                    </div>
                    <div className="bacteria-led">{state.patch.globalRouting.replace('-', ' ')}</div>
                </div>
                <div className="flex min-h-0 gap-2 overflow-x-auto">
                    {Array.from({ length: state.patch.bandCount }, (_, index) => (
                        <BandStrip
                            key={index}
                            index={index}
                            band={state.patch.bands[index]!}
                            isActive={state.activeBand === index}
                            onSelect={() => setBacteriaActiveBand(index)}
                            onParamChange={(key, value) =>
                                setBacteriaBandParamWithAudio(
                                    index,
                                    key as keyof BacteriaPatch['bands'][0],
                                    value as never
                                )
                            }
                        />
                    ))}
                </div>
            </div>
        </div>
    );
};

const BuildHero = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="flex h-full min-h-0 flex-col gap-2.5 p-2.5">
        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Band broth"
                title="Crossover tray"
                description="Split the signal, retune the boundaries, and keep the lanes readable."
                detail={`${state.patch.bandCount} bands`}
            />
            <SpectrumAnalyzer
                width={560}
                height={94}
                crossoverFreqs={[
                    state.patch.crossoverFreq1,
                    state.patch.crossoverFreq2,
                    state.patch.crossoverFreq3,
                    state.patch.crossoverFreq4,
                    state.patch.crossoverFreq5,
                ]}
                bandCount={state.patch.bandCount}
                activeBand={state.activeBand}
                showHeatmap
            />
            <CrossoverDisplay
                bandCount={state.patch.bandCount}
                crossoverFreqs={[
                    state.patch.crossoverFreq1,
                    state.patch.crossoverFreq2,
                    state.patch.crossoverFreq3,
                    state.patch.crossoverFreq4,
                    state.patch.crossoverFreq5,
                ]}
                crossoverMode={state.patch.crossoverMode}
                activeBand={state.activeBand}
                onBandSelect={setBacteriaActiveBand}
                onCrossoverChange={(index, freq) =>
                    setGlobalParam(`crossoverFreq${index + 1}` as keyof BacteriaPatch, freq as never)
                }
            />
        </div>

        <div className="bacteria-window flex min-h-0 flex-1 flex-col gap-3 p-3">
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">Band cards</div>
                    <div className="text-[12px] font-medium text-foreground">The organism split open</div>
                </div>
                <div className="bacteria-led">{state.patch.crossoverMode}</div>
            </div>
            <div className="flex min-h-0 gap-2 overflow-x-auto">
                {Array.from({ length: state.patch.bandCount }, (_, index) => (
                    <BandStrip
                        key={index}
                        index={index}
                        band={state.patch.bands[index]!}
                        isActive={state.activeBand === index}
                        onSelect={() => setBacteriaActiveBand(index)}
                        onParamChange={(key, value) =>
                            setBacteriaBandParamWithAudio(index, key as keyof BacteriaPatch['bands'][0], value as never)
                        }
                    />
                ))}
            </div>
        </div>
    </div>
);

const RouteHero = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="flex h-full min-h-0 flex-col gap-2.5 p-2.5">
        <div className="bacteria-window flex h-full min-h-0 flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Dish map"
                title="Signal petri"
                description="A compact routing map that stays legible in the shallow drawer."
                detail={state.patch.globalRouting.replace('-', ' ')}
            />
            <div className="flex flex-1 items-center justify-center">
                <NodeGraphEditor
                    width={620}
                    height={248}
                    bandCount={state.patch.bandCount}
                    bands={state.patch.bands}
                    globalRouting={state.patch.globalRouting}
                    crossoverFreqs={[
                        state.patch.crossoverFreq1,
                        state.patch.crossoverFreq2,
                        state.patch.crossoverFreq3,
                        state.patch.crossoverFreq4,
                        state.patch.crossoverFreq5,
                    ]}
                />
            </div>
        </div>
    </div>
);

const LabHero = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="grid h-full min-h-0 grid-cols-2 gap-2.5 p-2.5">
        <div className="bacteria-window flex min-h-0 flex-col gap-2.5 p-3">
            <SectionHeader
                eyebrow="Curve"
                title="Shaper bench"
                description="For when the default clipping law is too polite."
            />
            <div className="flex flex-1 items-center justify-center">
                <WaveshaperEditor width={300} height={176} segments={[]} onSegmentsChange={() => {}} />
            </div>
        </div>
        <div className="bacteria-window flex min-h-0 flex-col gap-2.5 p-3">
            <SectionHeader
                eyebrow="Motion"
                title="Bezier drift"
                description="Draw a wobble instead of babysitting a rate knob."
            />
            <div className="flex flex-1 items-center justify-center">
                <BezierLfoEditor width={300} height={176} points={[]} onPointsChange={() => {}} gridDivisions={8} />
            </div>
        </div>
        <div className="bacteria-window flex min-h-0 flex-col gap-2.5 p-3">
            <SectionHeader
                eyebrow="Steps"
                title="Sequencer"
                description="Fast lane for rhythmic stabs and gated mutations."
                detail={`${state.patch.stepSeqSteps} steps`}
            />
            <div className="flex flex-1 items-center justify-center">
                <StepSequencerEditor
                    width={300}
                    height={96}
                    steps={[]}
                    numSteps={state.patch.stepSeqSteps}
                    onStepsChange={() => {}}
                />
            </div>
        </div>
        <div className="bacteria-window flex min-h-0 flex-col gap-2.5 p-3">
            <SectionHeader
                eyebrow="Bins"
                title="Spectral gate"
                description="Carve holes in the top end without leaving the panel."
            />
            <div className="flex flex-1 items-center justify-center">
                <SpectralBinEditor width={300} height={96} binValues={[]} onBinValuesChange={() => {}} mode="gate" />
            </div>
        </div>
    </div>
);

function renderShapeControls(state: BacteriaState): ReactElement {
    const patch = state.patch;
    const band = patch.bands[state.activeBand] ?? patch.bands[0]!;
    const activeModule = state.activeModule;

    const setBandParam = <K extends keyof BacteriaPatch['bands'][0]>(key: K, value: BacteriaPatch['bands'][0][K]) => {
        setBacteriaBandParamWithAudio(state.activeBand, key, value);
    };

    return (
        <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-2.5">
            <div className="bacteria-window flex flex-col gap-3 p-3">
                <SectionHeader
                    eyebrow="Modules"
                    title="Pick the mutation"
                    description="Stay on one band and swap the active organism without losing the overall context."
                    detail={`Band ${state.activeBand + 1}`}
                />
                <div className="flex flex-wrap gap-1.5">
                    {EFFECT_MODULES.map((module) => {
                        const active = module.id === activeModule;

                        return (
                            <button
                                key={module.id}
                                type="button"
                                className={`bacteria-chip ${active ? 'bacteria-chip-active' : ''}`}
                                onClick={() => setBacteriaActiveModule(module.id)}
                            >
                                {module.label}
                            </button>
                        );
                    })}
                </div>
            </div>

            <div className="bacteria-window flex flex-col gap-3 p-3">
                <SectionHeader
                    eyebrow="Controls"
                    title={getModuleMeta(activeModule).label}
                    description={getModuleMeta(activeModule).hint}
                />

                {activeModule === 'distortion' ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className={`bacteria-chip ${Boolean(band.distortionEnabled) ? 'bacteria-chip-active' : ''}`}
                                aria-pressed={Boolean(band.distortionEnabled)}
                                onClick={() => setBandParam('distortionEnabled', !Boolean(band.distortionEnabled))}
                            >
                                Enabled
                            </button>
                            <div className="flex flex-wrap gap-1">
                                {DISTORTION_MODES.map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={`bacteria-chip ${band.distortionMode === mode ? 'bacteria-chip-active' : ''}`}
                                        onClick={() => setBandParam('distortionMode', mode)}
                                    >
                                        {mode.replace('-', ' ')}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.drive}
                                k="drive"
                                label="Drive"
                                min={0}
                                max={100}
                                step={1}
                                def={25}
                                unit="%"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.asymmetry}
                                k="asymmetry"
                                label="Asym"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0}
                                onChangeFn={setBandParam as never}
                            />
                            {band.distortionMode === 'foldback' ? (
                                <K
                                    v={band.foldbackThreshold}
                                    k="foldbackThreshold"
                                    label="Fold"
                                    min={0.1}
                                    max={1}
                                    step={0.01}
                                    def={0.7}
                                    onChangeFn={setBandParam as never}
                                />
                            ) : null}
                            {band.distortionMode === 'bitcrush' ? (
                                <>
                                    <K
                                        v={band.bitDepth}
                                        k="bitDepth"
                                        label="Bits"
                                        min={1}
                                        max={24}
                                        step={1}
                                        def={16}
                                        onChangeFn={setBandParam as never}
                                    />
                                    <K
                                        v={band.sampleRateReduce}
                                        k="sampleRateReduce"
                                        label="Rate div"
                                        min={1}
                                        max={64}
                                        step={1}
                                        def={1}
                                        onChangeFn={setBandParam as never}
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
                                    onChangeFn={setBandParam as never}
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
                                    onChangeFn={setBandParam as never}
                                />
                            ) : null}
                        </div>
                    </div>
                ) : null}

                {activeModule === 'filter' ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className={`bacteria-chip ${Boolean(band.filterEnabled) ? 'bacteria-chip-active' : ''}`}
                                aria-pressed={Boolean(band.filterEnabled)}
                                onClick={() => setBandParam('filterEnabled', !Boolean(band.filterEnabled))}
                            >
                                Enabled
                            </button>
                            <div className="flex flex-wrap gap-1">
                                {FILTER_MODES.map((mode) => (
                                    <button
                                        key={mode}
                                        type="button"
                                        className={`bacteria-chip ${band.filterMode === mode ? 'bacteria-chip-active' : ''}`}
                                        onClick={() => setBandParam('filterMode', mode)}
                                    >
                                        {mode}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.filterCutoff}
                                k="filterCutoff"
                                label="Cutoff"
                                min={20}
                                max={20000}
                                step={1}
                                def={8000}
                                unit="Hz"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.filterResonance}
                                k="filterResonance"
                                label="Reso"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.3}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.filterEnvAmount}
                                k="filterEnvAmount"
                                label="Env"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.filterEnvAttack}
                                k="filterEnvAttack"
                                label="Atk"
                                min={0.1}
                                max={500}
                                step={0.1}
                                def={5}
                                unit="ms"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.filterEnvRelease}
                                k="filterEnvRelease"
                                label="Rel"
                                min={1}
                                max={5000}
                                step={1}
                                def={200}
                                unit="ms"
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'chorus' ? (
                    <div className="space-y-3">
                        <button
                            type="button"
                            className={`bacteria-chip ${Boolean(band.chorusEnabled) ? 'bacteria-chip-active' : ''}`}
                            aria-pressed={Boolean(band.chorusEnabled)}
                            onClick={() => setBandParam('chorusEnabled', !Boolean(band.chorusEnabled))}
                        >
                            Enabled
                        </button>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.chorusRate}
                                k="chorusRate"
                                label="Rate"
                                min={0.01}
                                max={20}
                                step={0.01}
                                def={1.5}
                                unit="Hz"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.chorusDepth}
                                k="chorusDepth"
                                label="Depth"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.4}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.chorusFeedback}
                                k="chorusFeedback"
                                label="Feed"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0.2}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.chorusMix}
                                k="chorusMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'phaser' ? (
                    <div className="space-y-3">
                        <button
                            type="button"
                            className={`bacteria-chip ${Boolean(band.phaserEnabled) ? 'bacteria-chip-active' : ''}`}
                            aria-pressed={Boolean(band.phaserEnabled)}
                            onClick={() => setBandParam('phaserEnabled', !Boolean(band.phaserEnabled))}
                        >
                            Enabled
                        </button>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.phaserRate}
                                k="phaserRate"
                                label="Rate"
                                min={0.01}
                                max={10}
                                step={0.01}
                                def={0.5}
                                unit="Hz"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.phaserDepth}
                                k="phaserDepth"
                                label="Depth"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.7}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.phaserFeedback}
                                k="phaserFeedback"
                                label="Feed"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.phaserMix}
                                k="phaserMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'granular' ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className={`bacteria-chip ${Boolean(band.granularEnabled) ? 'bacteria-chip-active' : ''}`}
                                aria-pressed={Boolean(band.granularEnabled)}
                                onClick={() => setBandParam('granularEnabled', !Boolean(band.granularEnabled))}
                            >
                                Enabled
                            </button>
                            <button
                                type="button"
                                className={`bacteria-chip ${Boolean(band.grainFreeze) ? 'bacteria-chip-active' : ''}`}
                                aria-pressed={Boolean(band.grainFreeze)}
                                onClick={() => setBandParam('grainFreeze', !Boolean(band.grainFreeze))}
                            >
                                Freeze
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.grainSize}
                                k="grainSize"
                                label="Size"
                                min={10}
                                max={500}
                                step={1}
                                def={80}
                                unit="ms"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.grainDensity}
                                k="grainDensity"
                                label="Density"
                                min={1}
                                max={100}
                                step={1}
                                def={15}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.grainPosOffset}
                                k="grainPosOffset"
                                label="Offset"
                                min={0}
                                max={2000}
                                step={1}
                                def={100}
                                unit="ms"
                                onChangeFn={setBandParam as never}
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
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.grainMix}
                                k="grainMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'spectral' ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <button
                                type="button"
                                className={`bacteria-chip ${Boolean(band.spectralEnabled) ? 'bacteria-chip-active' : ''}`}
                                aria-pressed={Boolean(band.spectralEnabled)}
                                onClick={() => setBandParam('spectralEnabled', !Boolean(band.spectralEnabled))}
                            >
                                Enabled
                            </button>
                            <button
                                type="button"
                                className={`bacteria-chip ${Boolean(band.spectralFreeze) ? 'bacteria-chip-active' : ''}`}
                                aria-pressed={Boolean(band.spectralFreeze)}
                                onClick={() => setBandParam('spectralFreeze', !Boolean(band.spectralFreeze))}
                            >
                                Freeze
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.spectralBlur}
                                k="spectralBlur"
                                label="Blur"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.spectralMix}
                                k="spectralMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'freqShift' ? (
                    <div className="space-y-3">
                        <button
                            type="button"
                            className={`bacteria-chip ${Boolean(band.freqShiftEnabled) ? 'bacteria-chip-active' : ''}`}
                            aria-pressed={Boolean(band.freqShiftEnabled)}
                            onClick={() => setBandParam('freqShiftEnabled', !Boolean(band.freqShiftEnabled))}
                        >
                            Enabled
                        </button>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.freqShiftHz}
                                k="freqShiftHz"
                                label="Shift"
                                min={-1000}
                                max={1000}
                                step={0.1}
                                def={0}
                                unit="Hz"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.freqShiftMix}
                                k="freqShiftMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'lofi' ? (
                    <div className="space-y-3">
                        <button
                            type="button"
                            className={`bacteria-chip ${Boolean(band.lofiEnabled) ? 'bacteria-chip-active' : ''}`}
                            aria-pressed={Boolean(band.lofiEnabled)}
                            onClick={() => setBandParam('lofiEnabled', !Boolean(band.lofiEnabled))}
                        >
                            Enabled
                        </button>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.lofiAmount}
                                k="lofiAmount"
                                label="Amount"
                                min={0}
                                max={100}
                                step={1}
                                def={0}
                                unit="%"
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.codecArtifact}
                                k="codecArtifact"
                                label="Codec"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}

                {activeModule === 'convolution' ? (
                    <div className="space-y-3">
                        <button
                            type="button"
                            className={`bacteria-chip ${Boolean(band.convolutionEnabled) ? 'bacteria-chip-active' : ''}`}
                            aria-pressed={Boolean(band.convolutionEnabled)}
                            onClick={() => setBandParam('convolutionEnabled', !Boolean(band.convolutionEnabled))}
                        >
                            Enabled
                        </button>
                        <div className="flex flex-wrap gap-4">
                            <K
                                v={band.convolutionMix}
                                k="convolutionMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.3}
                                onChangeFn={setBandParam as never}
                            />
                            <K
                                v={band.convolutionSeparation}
                                k="convolutionSeparation"
                                label="Spread"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onChangeFn={setBandParam as never}
                            />
                        </div>
                    </div>
                ) : null}
            </div>

            <div className="bacteria-window flex flex-col gap-3 p-3">
                <SectionHeader
                    eyebrow="Quick modulation"
                    title="Fast movers"
                    description="Enough motion control to shape the active mutation without going full bench mode."
                />
                <div className="flex flex-wrap gap-4">
                    <K
                        v={patch.lfo1Rate}
                        k="lfo1Rate"
                        label="LFO 1"
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
    );
}

const BuildDeck = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-2.5">
        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Split"
                title="Crossover controls"
                description="Keep the lane count and slope close at hand."
            />
            <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6].map((count) => (
                    <button
                        key={count}
                        type="button"
                        className={`bacteria-chip ${state.patch.bandCount === count ? 'bacteria-chip-active' : ''}`}
                        onClick={() => {
                            setGlobalParam('bandCount', count);
                            if (state.activeBand >= count) {
                                setBacteriaActiveBand(count - 1);
                            }
                        }}
                    >
                        {count} band{count === 1 ? '' : 's'}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                {['12', '24', '36', '48'].map((slope, index) => (
                    <button
                        key={slope}
                        type="button"
                        className={`bacteria-chip ${state.patch.crossoverSlope === index ? 'bacteria-chip-active' : ''}`}
                        onClick={() => setGlobalParam('crossoverSlope', index)}
                    >
                        {slope} dB
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                {(['lr4', 'linear-phase'] as const).map((mode) => (
                    <button
                        key={mode}
                        type="button"
                        className={`bacteria-chip ${state.patch.crossoverMode === mode ? 'bacteria-chip-active' : ''}`}
                        onClick={() => setGlobalParam('crossoverMode', mode)}
                    >
                        {mode === 'lr4' ? 'LR4' : 'Linear'}
                    </button>
                ))}
            </div>
        </div>

        <div className="bacteria-window flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
            <SectionHeader
                eyebrow="Modulation"
                title="Source dock"
                description="Still compact, still visible, and less stranded than before."
            />
            <ModulationDock
                patch={state.patch}
                modValues={[]}
                onAssignmentAdd={() => {}}
                onAssignmentRemove={() => {}}
            />
        </div>
    </div>
);

const RouteDeck = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-2.5">
        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Global"
                title="Routing mode"
                description="Choose how the bands behave before you dive into the per-band overrides."
            />
            <div className="flex flex-wrap gap-2">
                {ROUTING_MODES.map((mode) => (
                    <button
                        key={mode}
                        type="button"
                        className={`bacteria-chip ${state.patch.globalRouting === mode ? 'bacteria-chip-active' : ''}`}
                        onClick={() => setGlobalParam('globalRouting', mode)}
                    >
                        {mode === 'serial' ? 'Serial' : mode === 'parallel' ? 'Parallel' : 'Mid/side'}
                    </button>
                ))}
            </div>
        </div>

        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Per band"
                title="Lane overrides"
                description="Useful when one band needs to misbehave on its own."
            />
            <div className="flex flex-col gap-2">
                {Array.from({ length: state.patch.bandCount }, (_, index) => (
                    <div key={index} className="bacteria-window flex items-center justify-between gap-3 px-3 py-2">
                        <span className="text-[11px] font-medium text-foreground">Band {index + 1}</span>
                        <div className="flex flex-wrap gap-1">
                            {ROUTING_MODES.map((mode) => (
                                <button
                                    key={mode}
                                    type="button"
                                    className={`bacteria-chip ${state.patch.bands[index]?.routingMode === mode ? 'bacteria-chip-active' : ''}`}
                                    onClick={() => setBacteriaBandParamWithAudio(index, 'routingMode', mode)}
                                >
                                    {mode === 'mid-side' ? 'M/S' : mode}
                                </button>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    </div>
);

const LabDeck = ({ state }: { state: BacteriaState }): ReactElement => (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-2.5">
        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="LFOs"
                title="Motion core"
                description="Rates and shapes for the built-in wigglers."
            />
            <div className="flex flex-wrap gap-4">
                <K
                    v={state.patch.lfo1Rate}
                    k="lfo1Rate"
                    label="LFO 1"
                    min={0.01}
                    max={40}
                    step={0.01}
                    def={2}
                    unit="Hz"
                />
                <K v={state.patch.lfo1Amount} k="lfo1Amount" label="Amt 1" min={0} max={1} step={0.01} def={0.5} />
                <K
                    v={state.patch.lfo2Rate}
                    k="lfo2Rate"
                    label="LFO 2"
                    min={0.01}
                    max={40}
                    step={0.01}
                    def={0.5}
                    unit="Hz"
                />
                <K v={state.patch.lfo2Amount} k="lfo2Amount" label="Amt 2" min={0} max={1} step={0.01} def={0.5} />
            </div>
            <div className="flex flex-wrap gap-2">
                {['Sin', 'Tri', 'Saw', 'Sq', 'S&H'].map((shape, index) => (
                    <button
                        key={`lfo1-${shape}`}
                        type="button"
                        className={`bacteria-chip ${state.patch.lfo1Shape === index ? 'bacteria-chip-active' : ''}`}
                        onClick={() => setGlobalParam('lfo1Shape', index)}
                    >
                        LFO1 {shape}
                    </button>
                ))}
            </div>
            <div className="flex flex-wrap gap-2">
                {['Sin', 'Tri', 'Saw', 'Sq', 'S&H'].map((shape, index) => (
                    <button
                        key={`lfo2-${shape}`}
                        type="button"
                        className={`bacteria-chip ${state.patch.lfo2Shape === index ? 'bacteria-chip-active' : ''}`}
                        onClick={() => setGlobalParam('lfo2Shape', index)}
                    >
                        LFO2 {shape}
                    </button>
                ))}
            </div>
        </div>

        <div className="bacteria-window flex flex-col gap-3 p-3">
            <SectionHeader
                eyebrow="Followers"
                title="Bench controls"
                description="Envelope, Lorenz, and steps in one place."
            />
            <div className="flex flex-wrap gap-4">
                <K
                    v={state.patch.envFollowerAttack}
                    k="envFollowerAttack"
                    label="Env Atk"
                    min={0.1}
                    max={100}
                    step={0.1}
                    def={5}
                    unit="ms"
                />
                <K
                    v={state.patch.envFollowerRelease}
                    k="envFollowerRelease"
                    label="Env Rel"
                    min={1}
                    max={2000}
                    step={1}
                    def={200}
                    unit="ms"
                />
                <K v={state.patch.stepSeqSteps} k="stepSeqSteps" label="Steps" min={1} max={32} step={1} def={16} />
                <K
                    v={state.patch.stepSeqRate}
                    k="stepSeqRate"
                    label="Step Hz"
                    min={0.5}
                    max={32}
                    step={0.5}
                    def={4}
                    unit="Hz"
                />
                <K v={state.patch.lorenzSigma} k="lorenzSigma" label="Sigma" min={1} max={30} step={0.1} def={10} />
                <K v={state.patch.lorenzRho} k="lorenzRho" label="Rho" min={1} max={50} step={0.1} def={28} />
                <K v={state.patch.lorenzBeta} k="lorenzBeta" label="Beta" min={0.1} max={10} step={0.01} def={2.667} />
                <K v={state.patch.lorenzSpeed} k="lorenzSpeed" label="Speed" min={0.01} max={10} step={0.01} def={1} />
            </div>
        </div>
    </div>
);

function renderHero(state: BacteriaState): ReactElement {
    if (state.uiLevel === 1) {
        return <PlayHero state={state} />;
    }
    if (state.uiLevel === 2) {
        return <ShapeHero state={state} />;
    }
    if (state.uiLevel === 3) {
        return <BuildHero state={state} />;
    }
    if (state.uiLevel === 4) {
        return <RouteHero state={state} />;
    }
    return <LabHero state={state} />;
}

function renderDeck(state: BacteriaState): ReactElement {
    if (state.uiLevel === 1) {
        return <PlayDeck state={state} />;
    }
    if (state.uiLevel === 2) {
        return renderShapeControls(state);
    }
    if (state.uiLevel === 3) {
        return <BuildDeck state={state} />;
    }
    if (state.uiLevel === 4) {
        return <RouteDeck state={state} />;
    }
    return <LabDeck state={state} />;
}

export const BacteriaPanel = (): ReactElement => {
    const state = useSyncExternalStore<BacteriaState | null>(
        (cb) => bacteriaStore.subscribe(cb),
        () => bacteriaStore.value
    );
    const [presetQuery, setPresetQuery] = useState('');
    const [presetCategory, setPresetCategory] = useState('All');
    const [, startFilterTransition] = useTransition();

    if (!state) {
        return <div className="flex h-full items-center justify-center text-muted-foreground">Loading...</div>;
    }

    const activeLevel = getActiveLevel(state.uiLevel);
    const activeBand = state.patch.bands[state.activeBand] ?? state.patch.bands[0]!;
    const moduleMeta = getModuleMeta(state.activeModule);

    return (
        <div className="bacteria-faceplate flex h-full min-h-0 gap-2.5 overflow-hidden p-2.5">
            <PresetRail
                state={state}
                query={presetQuery}
                category={presetCategory}
                onQueryChange={(value) => {
                    startFilterTransition(() => {
                        setPresetQuery(value);
                    });
                }}
                onCategoryChange={(value) => {
                    startFilterTransition(() => {
                        setPresetCategory(value);
                    });
                }}
            />

            <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                <header className="bacteria-window flex shrink-0 flex-wrap items-center gap-2.5 px-3 py-2">
                    <div className="space-y-1">
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]/70">
                            {activeLevel.eyebrow}
                        </div>
                        <div className="text-[13px] font-semibold text-foreground">Bacteria</div>
                    </div>

                    <div className="flex flex-wrap gap-1.5">
                        {LEVELS.map((level) => {
                            const active = level.id === state.uiLevel;

                            return (
                                <button
                                    key={level.id}
                                    type="button"
                                    className={`bacteria-chip ${active ? 'bacteria-chip-active' : ''}`}
                                    title={level.description}
                                    onClick={() => setBacteriaUiLevel(level.id)}
                                >
                                    {level.label}
                                </button>
                            );
                        })}
                    </div>

                    {state.uiLevel >= 2 ? (
                        <div className="flex flex-wrap gap-1">
                            {Array.from({ length: state.patch.bandCount }, (_, index) => (
                                <button
                                    key={index}
                                    type="button"
                                    className={`bacteria-chip ${state.activeBand === index ? 'bacteria-chip-active' : ''}`}
                                    onClick={() => setBacteriaActiveBand(index)}
                                >
                                    Band {index + 1}
                                </button>
                            ))}
                        </div>
                    ) : null}

                    <div className="ml-auto flex items-center gap-2">
                        <div className="bacteria-led">{moduleMeta.label}</div>
                        <div className="text-right">
                            <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">
                                In {formatValue(state.inputDb, 'dB')} / Out {formatValue(state.outputDb, 'dB')}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                {countEnabledEffects(activeBand)} active effects in band {state.activeBand + 1}
                            </div>
                        </div>
                        <button
                            type="button"
                            className={`bacteria-chip ${Boolean(state.patch.bypass) ? 'bacteria-chip-active' : ''}`}
                            aria-pressed={Boolean(state.patch.bypass)}
                            onClick={() => setGlobalParam('bypass', !Boolean(state.patch.bypass))}
                        >
                            {Boolean(state.patch.bypass) ? 'Bypassed' : 'Live'}
                        </button>
                    </div>
                </header>

                <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(320px,0.92fr)] gap-2.5 overflow-hidden">
                    <section className="bacteria-window min-h-0 overflow-hidden">{renderHero(state)}</section>
                    <section className="bacteria-window min-h-0 overflow-hidden">{renderDeck(state)}</section>
                </div>

                <footer className="grid shrink-0 grid-cols-[repeat(4,minmax(0,auto))_minmax(0,1fr)] gap-2.5">
                    <MetricCell label="Input" value={formatValue(state.inputDb, 'dB')} />
                    <MetricCell label="Output" value={formatValue(state.outputDb, 'dB')} />
                    <MetricCell label="Latency" value={state.latency > 0 ? `${state.latency} smp` : '0 smp'} />
                    <MetricCell label="Active band" value={`B${state.activeBand + 1}`} />
                    <BandMeters state={state} />
                </footer>
            </div>
        </div>
    );
};
