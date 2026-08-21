import { type ReactElement, useState, useTransition } from 'react';

import { Search } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Grid, Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';

import { type BacteriaPatch } from '../../models/BacteriaPatch';
import {
    bacteriaStore,
    type BacteriaState,
    type BacteriaUiLevel,
    getBacteriaState,
    setBacteriaActiveBand,
    setBacteriaActiveModule,
    setBacteriaUiLevel,
} from '../../stores/bacteriaStore';
import { loadBacteriaPatchWithAudio } from '../../useCases/bacteriaParamBridge/loadBacteriaPatchWithAudio';
import { setBacteriaBandParamWithAudio } from '../../useCases/bacteriaParamBridge/setBacteriaBandParamWithAudio';
import { setBacteriaParamWithAudio } from '../../useCases/bacteriaParamBridge/setBacteriaParamWithAudio';
import { BACTERIA_PRESETS } from '../../useCases/bacteriaPresets';
import { BandStrip } from '../components/BandStrip';
import { BezierLfoEditor } from '../components/BezierLfoEditor';
import { CrossoverDisplay } from '../components/CrossoverDisplay';
import { ModulationDock } from '../components/ModulationDock';
import { NodeGraphEditor } from '../components/NodeGraphEditor';
import { SpectralBinEditor } from '../components/SpectralBinEditor';
import { SpectrumAnalyzer } from '../components/SpectrumAnalyzer';
import { StepSequencerEditor } from '../components/StepSequencerEditor';
import { WaveshaperEditor } from '../components/WaveshaperEditor';
import { XYMorphPad } from '../components/XYMorphPad';

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

    return EFFECT_MODULES[0];
}

type BacteriaBand = BacteriaPatch['bands'][number];

/**
 * Keys of `T` whose value is a `number`. Every K knob writes a numeric scalar,
 * so the writable key set is exactly the numeric keys — this both removes the
 * old unsound value cast (the value is provably assignable to `T[K]`) and
 * keeps boolean/string/enum fields out of a knob's reach at compile time.
 */
type NumericKeys<TObj> = { [TProp in keyof TObj]: TObj[TProp] extends number ? TProp : never }[keyof TObj];

type NumericGlobalKey = NumericKeys<BacteriaPatch>;
type NumericBandKey = NumericKeys<BacteriaBand>;

/**
 * Write a numeric global param. The key is constrained to the global patch's
 * numeric keys, so a band key cannot be passed here and the value needs no cast.
 */
function setGlobalParam(deviceId: string, key: NumericGlobalKey, value: number): void {
    setBacteriaParamWithAudio(deviceId, key, value);
}

/** Boolean-typed band fields BandStrip toggles via a numeric 0/1 payload. */
const BAND_BOOLEAN_KEYS = ['solo', 'mute'] as const;
type BandBooleanKey = (typeof BAND_BOOLEAN_KEYS)[number];

function isBandBooleanKey(key: keyof BacteriaBand): key is BandBooleanKey {
    return (BAND_BOOLEAN_KEYS as readonly string[]).includes(key);
}

/**
 * Route a BandStrip param change to the typed band write. BandStrip's contract
 * is `(key: string, value: number)` — it encodes the boolean solo/mute fields
 * as 0/1 — so this boundary decodes those back to `boolean` and forwards the
 * rest as numeric. Each branch hands a value whose type matches the field, so
 * no unsound value cast is needed.
 */
function setBandParamFromStrip(deviceId: string, bandIndex: number, key: string, value: number): void {
    const bandKey = key as keyof BacteriaBand;
    if (isBandBooleanKey(bandKey)) {
        setBacteriaBandParamWithAudio(deviceId, bandIndex, bandKey, value !== 0);
        return;
    }
    setBacteriaBandParamWithAudio(deviceId, bandIndex, bandKey as NumericBandKey, value);
}

type KnobChromeProps = {
    v: number;
    label: string;
    min: number;
    max: number;
    step: number;
    def: number;
    unit?: string;
};

/**
 * Knob props as a discriminated union over the write path.
 *
 *  - Global variant (no `onBandChange`): `k` must be a numeric *global* key and
 *    the change is routed to `setGlobalParam`.
 *  - Band variant (`onBandChange` present): `k` must be a numeric *band* key and
 *    the only write path is the supplied `onBandChange`.
 *
 * Because each variant pins `k` to the matching numeric key set, a band key
 * cannot be supplied to the global variant — so a band param can never reach
 * `setGlobalParam`, and the change value needs no cast (it is provably a
 * `number` assignable to the field). This removes the previous unsound-cast
 * escapes and the unguarded band→global fallback at the same time.
 */
type KGlobalProps = KnobChromeProps & {
    deviceId: string;
    k: NumericGlobalKey;
    onBandChange?: undefined;
};

type KBandProps = KnobChromeProps & {
    k: NumericBandKey;
    onBandChange: (key: NumericBandKey, value: number) => void;
};

type KProps = KGlobalProps | KBandProps;

const K = (props: KProps): ReactElement => {
    const { v, label, min, max, step, def, unit } = props;
    const onChange =
        props.onBandChange === undefined
            ? (value: number) => setGlobalParam(props.deviceId, props.k, value)
            : (value: number) => props.onBandChange(props.k, value);

    return (
        <Stack align="center" gap={1} className="min-w-[58px]">
            <RotaryKnob
                value={v}
                onChange={onChange}
                min={min}
                max={max}
                step={step}
                defaultValue={def}
                size="sm"
                tone="mint"
                aria-label={label}
            />
            <span className="text-[8px] leading-none text-muted-foreground">{label}</span>
            {unit ? (
                <span className="font-mono text-[7px] text-muted-foreground/45">{formatValue(v, unit)}</span>
            ) : null}
        </Stack>
    );
};

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
    <Row align="start" justify="between" gap={3}>
        <Stack gap={1}>
            <div className="text-[8px] font-semibold uppercase tracking-[0.28em] text-[var(--color-accent-mint-bright)]/70">
                {eyebrow}
            </div>
            <div className="text-[13px] font-semibold tracking-[0.02em] text-foreground">{title}</div>
            <span className="sr-only">{description}</span>
        </Stack>
        {detail ? (
            <DawPluginLed tone="mint" className="shrink-0">
                {detail}
            </DawPluginLed>
        ) : null}
    </Row>
);

const BChip = ({
    active = false,
    size = 'sm',
    className,
    children,
    ...props
}: React.ComponentProps<typeof DawPluginChip>): ReactElement => (
    <DawPluginChip active={active} tone="mint" size={size} className={className} {...props}>
        {children}
    </DawPluginChip>
);

const MetricCell = ({ label, value }: { label: string; value: string }): ReactElement => (
    <Stack gap={1} className="bacteria-window min-w-[92px] px-3 py-2">
        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">{label}</span>
        <span className="font-mono text-[12px] text-foreground">{value}</span>
    </Stack>
);

const BandMeters = ({ state }: { state: BacteriaState }): ReactElement => (
    <Stack gap={2} className="bacteria-window px-3 py-2">
        <Row justify="between" gap={2}>
            <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">Band energy</span>
            <span className="text-[8px] text-muted-foreground/45">{state.patch.bandCount} active lanes</span>
        </Row>
        <Row gap={2}>
            {Array.from({ length: state.patch.bandCount }, (_, index) => {
                const level = Math.max(0, Math.min(1, ((state.bandLevels[index] ?? -60) + 60) / 60));
                return (
                    <Stack key={index} gap={1} grow className="min-w-0">
                        <div className="h-2 overflow-hidden rounded-full bg-black/40">
                            <div
                                className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent-mint),var(--color-accent-cyan),var(--color-accent-lavender))]"
                                style={{ width: `${Math.max(6, level * 100)}%` }}
                            />
                        </div>
                        <Row justify="between" gap={2} className="text-[8px] text-muted-foreground/45">
                            <span>B{index + 1}</span>
                            <span className="font-mono">{formatValue(state.bandLevels[index] ?? -100, 'dB')}</span>
                        </Row>
                    </Stack>
                );
            })}
        </Row>
    </Stack>
);

const PresetRail = ({
    deviceId,
    state,
    query,
    category,
    onQueryChange,
    onCategoryChange,
}: {
    deviceId: string;
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
        <Stack
            as="aside"
            gap={2}
            shrink={false}
            className="bacteria-window h-full w-[248px] gap-2.5 overflow-hidden p-2.5"
        >
            <SectionHeader
                eyebrow="Presets"
                title="Cultures"
                description="Search the jars, filter the mess, and load a starting organism."
                detail={`${filteredPresets.length} shown`}
            />

            <Row gap={2} className="bacteria-window px-3 py-2">
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
            </Row>

            <Row wrap gap={1}>
                {categories.map((entry) => {
                    const isActive = category === entry;

                    return (
                        <BChip key={entry} active={isActive} onClick={() => onCategoryChange(entry)}>
                            {entry}
                        </BChip>
                    );
                })}
            </Row>

            <Stack grow className="bacteria-window min-h-0 overflow-hidden">
                <Row justify="between" gap={2} className="border-b border-white/6 px-3 py-2">
                    <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                        Preset drawer
                    </span>
                    <span className="text-[8px] text-muted-foreground/45">{state.patch.name}</span>
                </Row>
                <Stack grow gap={1} className="min-h-0 overflow-y-auto px-2 py-2">
                    {filteredPresets.length > 0 ? (
                        filteredPresets.map((preset) => {
                            const active = preset.patch.name === state.patch.name;

                            return (
                                <Stack
                                    key={preset.id}
                                    as="button"
                                    align="start"
                                    gap={1}
                                    className={`bacteria-window w-full px-3 py-2 text-left ${
                                        active ? 'border-[var(--color-accent-mint-bright)]/35' : ''
                                    }`}
                                    onClick={() => loadBacteriaPatchWithAudio(deviceId, preset.patch)}
                                >
                                    <span className="text-[11px] font-medium text-foreground">{preset.name}</span>
                                    <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/50">
                                        {preset.category}
                                    </span>
                                </Stack>
                            );
                        })
                    ) : (
                        <Stack
                            align="center"
                            justify="center"
                            className="h-full px-4 text-center text-[11px] text-muted-foreground"
                        >
                            Nothing matches that jar label yet.
                        </Stack>
                    )}
                </Stack>
            </Stack>

            <Grid cols={2} gap={2}>
                <MetricCell label="Bands" value={`${state.patch.bandCount}`} />
                <MetricCell label="Routing" value={state.patch.globalRouting.replace('-', '/')} />
                <MetricCell label="Active FX" value={`${countEnabledEffects(activeBand)}`} />
                <MetricCell label="Mix" value={formatValue(state.patch.mix * 100, '%')} />
            </Grid>
        </Stack>
    );
};

const PlayHero = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => (
    <Grid gap={2} className="h-full min-h-0 grid-cols-[minmax(250px,0.92fr)_minmax(0,1.2fr)] gap-2.5 p-2.5">
        <Stack gap={3} className="bacteria-window min-h-0 p-3">
            <SectionHeader
                eyebrow="Petri pad"
                title="Morph field"
                description="Drag the crosshair and smear the patch between the four snapshot corners."
                detail="A/B/C/D"
            />
            <Stack grow align="center" justify="center">
                <XYMorphPad
                    x={state.patch.morphX}
                    y={state.patch.morphY}
                    onChangeX={(value) => setGlobalParam(deviceId, 'morphX', value)}
                    onChangeY={(value) => setGlobalParam(deviceId, 'morphY', value)}
                    snapshots={state.patch.snapshots}
                    width={264}
                    height={212}
                />
            </Stack>
            <Grid cols={4} gap={2}>
                {state.patch.snapshots.slice(0, 4).map((snapshot) => (
                    <Stack key={snapshot.id} gap={1} className="bacteria-window px-3 py-2">
                        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                            Snap {snapshot.id}
                        </span>
                        <span className="truncate text-[11px] text-foreground">{snapshot.name}</span>
                    </Stack>
                ))}
            </Grid>
        </Stack>

        <Stack gap={2} className="min-h-0 gap-2.5">
            <Stack gap={3} className="bacteria-window p-3">
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
                    onBandSelect={(index) => setBacteriaActiveBand(deviceId, index)}
                    onCrossoverChange={(index, freq) =>
                        setGlobalParam(deviceId, `crossoverFreq${index + 1}` as NumericGlobalKey, freq)
                    }
                />
            </Stack>

            <Grid cols={2} gap={2} className="min-h-0 flex-1 gap-2.5">
                <Stack gap={3} className="bacteria-window p-3">
                    <SectionHeader
                        eyebrow="Input"
                        title="Gain staging"
                        description="Keep the organism fed, not flooded."
                    />
                    <Row wrap gap={4}>
                        <K
                            deviceId={deviceId}
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
                            deviceId={deviceId}
                            v={state.patch.outputGain}
                            k="outputGain"
                            label="Output"
                            min={-24}
                            max={24}
                            step={0.5}
                            def={0}
                            unit="dB"
                        />
                        <K
                            deviceId={deviceId}
                            v={state.patch.mix}
                            k="mix"
                            label="Mix"
                            min={0}
                            max={1}
                            step={0.01}
                            def={1}
                        />
                    </Row>
                </Stack>
                <BandMeters state={state} />
            </Grid>
        </Stack>
    </Grid>
);

const PlayDeck = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => (
    <Stack gap={2} className="h-full min-h-0 gap-2.5 overflow-y-auto p-2.5">
        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="Macros"
                title="Performance cluster"
                description="Eight knobs for pushing the patch around without diving into the microscope."
                detail="8 slots"
            />
            <Grid cols={4} gapX={2} gapY={4}>
                {([1, 2, 3, 4, 5, 6, 7, 8] as const).map((index) => (
                    <K
                        key={index}
                        deviceId={deviceId}
                        v={state.patch[`macro${index}` as keyof BacteriaPatch] as number}
                        k={`macro${index}`}
                        label={`Macro ${index}`}
                        min={0}
                        max={1}
                        step={0.01}
                        def={0.5}
                    />
                ))}
            </Grid>
        </Stack>

        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="Morph"
                title="Crosshair offsets"
                description="Fine-tune the resting position without dragging the pad."
            />
            <Row wrap gap={4}>
                <K
                    deviceId={deviceId}
                    v={state.patch.morphX}
                    k="morphX"
                    label="X"
                    min={0}
                    max={1}
                    step={0.01}
                    def={0.5}
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.morphY}
                    k="morphY"
                    label="Y"
                    min={0}
                    max={1}
                    step={0.01}
                    def={0.5}
                />
            </Row>
        </Stack>
    </Stack>
);

const ShapeHero = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => {
    const moduleMeta = getModuleMeta(state.activeModule);

    return (
        <Stack gap={2} className="h-full min-h-0 gap-2.5 p-2.5">
            <Stack gap={3} className="bacteria-window p-3">
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
                    onBandSelect={(index) => setBacteriaActiveBand(deviceId, index)}
                    onCrossoverChange={(index, freq) =>
                        setGlobalParam(deviceId, `crossoverFreq${index + 1}` as NumericGlobalKey, freq)
                    }
                />
            </Stack>

            <Stack grow gap={3} className="bacteria-window min-h-0 p-3">
                <Row justify="between" gap={3}>
                    <Stack gap={1}>
                        <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">
                            Band broth
                        </div>
                        <div className="text-[12px] font-medium text-foreground">Zoomed strips</div>
                    </Stack>
                    <DawPluginLed tone="mint">{state.patch.globalRouting.replace('-', ' ')}</DawPluginLed>
                </Row>
                <Row gap={2} className="min-h-0 overflow-x-auto">
                    {Array.from({ length: state.patch.bandCount }, (_, index) => (
                        <BandStrip
                            key={index}
                            index={index}
                            band={state.patch.bands[index]!}
                            isActive={state.activeBand === index}
                            onSelect={() => setBacteriaActiveBand(deviceId, index)}
                            onParamChange={(key, value) => setBandParamFromStrip(deviceId, index, key, value)}
                        />
                    ))}
                </Row>
            </Stack>
        </Stack>
    );
};

const BuildHero = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => (
    <Stack gap={2} className="h-full min-h-0 gap-2.5 p-2.5">
        <Stack gap={3} className="bacteria-window p-3">
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
                onBandSelect={(index) => setBacteriaActiveBand(deviceId, index)}
                onCrossoverChange={(index, freq) =>
                    setGlobalParam(deviceId, `crossoverFreq${index + 1}` as NumericGlobalKey, freq)
                }
            />
        </Stack>

        <Stack grow gap={3} className="bacteria-window min-h-0 p-3">
            <Row justify="between" gap={2}>
                <Stack gap={1}>
                    <div className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">Band cards</div>
                    <div className="text-[12px] font-medium text-foreground">The organism split open</div>
                </Stack>
                <DawPluginLed tone="mint">{state.patch.crossoverMode}</DawPluginLed>
            </Row>
            <Row gap={2} className="min-h-0 overflow-x-auto">
                {Array.from({ length: state.patch.bandCount }, (_, index) => (
                    <BandStrip
                        key={index}
                        index={index}
                        band={state.patch.bands[index]!}
                        isActive={state.activeBand === index}
                        onSelect={() => setBacteriaActiveBand(deviceId, index)}
                        onParamChange={(key, value) => setBandParamFromStrip(deviceId, index, key, value)}
                    />
                ))}
            </Row>
        </Stack>
    </Stack>
);

const RouteHero = ({ state }: { state: BacteriaState }): ReactElement => (
    <Stack gap={2} className="h-full min-h-0 gap-2.5 p-2.5">
        <Stack gap={3} className="bacteria-window h-full min-h-0 p-3">
            <SectionHeader
                eyebrow="Dish map"
                title="Signal petri"
                description="A compact routing map that stays legible in the shallow drawer."
                detail={state.patch.globalRouting.replace('-', ' ')}
            />
            <Stack grow align="center" justify="center">
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
            </Stack>
        </Stack>
    </Stack>
);

const LabHero = ({ state }: { state: BacteriaState }): ReactElement => (
    <Grid cols={2} gap={2} className="h-full min-h-0 gap-2.5 p-2.5">
        <Stack gap={2} className="bacteria-window min-h-0 gap-2.5 p-3">
            <SectionHeader
                eyebrow="Curve"
                title="Shaper bench"
                description="For when the default clipping law is too polite."
            />
            <Stack grow align="center" justify="center">
                <WaveshaperEditor width={300} height={176} segments={[]} onSegmentsChange={() => {}} />
            </Stack>
        </Stack>
        <Stack gap={2} className="bacteria-window min-h-0 gap-2.5 p-3">
            <SectionHeader
                eyebrow="Motion"
                title="Bezier drift"
                description="Draw a wobble instead of babysitting a rate knob."
            />
            <Stack grow align="center" justify="center">
                <BezierLfoEditor width={300} height={176} points={[]} onPointsChange={() => {}} gridDivisions={8} />
            </Stack>
        </Stack>
        <Stack gap={2} className="bacteria-window min-h-0 gap-2.5 p-3">
            <SectionHeader
                eyebrow="Steps"
                title="Sequencer"
                description="Fast lane for rhythmic stabs and gated mutations."
                detail={`${state.patch.stepSeqSteps} steps`}
            />
            <Stack grow align="center" justify="center">
                <StepSequencerEditor
                    width={300}
                    height={96}
                    steps={[]}
                    numSteps={state.patch.stepSeqSteps}
                    onStepsChange={() => {}}
                />
            </Stack>
        </Stack>
        <Stack gap={2} className="bacteria-window min-h-0 gap-2.5 p-3">
            <SectionHeader
                eyebrow="Bins"
                title="Spectral gate"
                description="Carve holes in the top end without leaving the panel."
            />
            <Stack grow align="center" justify="center">
                <SpectralBinEditor width={300} height={96} binValues={[]} onBinValuesChange={() => {}} mode="gate" />
            </Stack>
        </Stack>
    </Grid>
);

function renderShapeControls(deviceId: string, state: BacteriaState): ReactElement {
    const patch = state.patch;
    const band = patch.bands[state.activeBand] ?? patch.bands[0]!;
    const activeModule = state.activeModule;

    const setBandParam = <TKey extends keyof BacteriaPatch['bands'][0]>(
        key: TKey,
        value: BacteriaPatch['bands'][0][TKey]
    ) => {
        setBacteriaBandParamWithAudio(deviceId, state.activeBand, key, value);
    };

    return (
        <Stack gap={2} className="h-full min-h-0 gap-2.5 overflow-y-auto p-2.5">
            <Stack gap={3} className="bacteria-window p-3">
                <SectionHeader
                    eyebrow="Modules"
                    title="Pick the mutation"
                    description="Stay on one band and swap the active organism without losing the overall context."
                    detail={`Band ${state.activeBand + 1}`}
                />
                <Row wrap gap={1} className="gap-1.5">
                    {EFFECT_MODULES.map((module) => {
                        const active = module.id === activeModule;

                        return (
                            <BChip
                                key={module.id}
                                active={active}
                                onClick={() => setBacteriaActiveModule(deviceId, module.id)}
                            >
                                {module.label}
                            </BChip>
                        );
                    })}
                </Row>
            </Stack>
            <Stack gap={3} className="bacteria-window p-3">
                <SectionHeader
                    eyebrow="Controls"
                    title={getModuleMeta(activeModule).label}
                    description={getModuleMeta(activeModule).hint}
                />

                {activeModule === 'distortion' ? (
                    <Stack gap={3}>
                        <Row gap={2}>
                            <BChip
                                active={Boolean(band.distortionEnabled)}
                                onClick={() => setBandParam('distortionEnabled', !band.distortionEnabled)}
                            >
                                Enabled
                            </BChip>
                            <Row wrap gap={1}>
                                {DISTORTION_MODES.map((mode) => (
                                    <BChip
                                        key={mode}
                                        active={band.distortionMode === mode}
                                        onClick={() => setBandParam('distortionMode', mode)}
                                    >
                                        {mode.replace('-', ' ')}
                                    </BChip>
                                ))}
                            </Row>
                        </Row>
                        <Row wrap gap={4}>
                            <K
                                v={band.drive}
                                k="drive"
                                label="Drive"
                                min={0}
                                max={100}
                                step={1}
                                def={25}
                                unit="%"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.asymmetry}
                                k="asymmetry"
                                label="Asym"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0}
                                onBandChange={setBandParam}
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
                                    onBandChange={setBandParam}
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
                                        onBandChange={setBandParam}
                                    />
                                    <K
                                        v={band.sampleRateReduce}
                                        k="sampleRateReduce"
                                        label="Rate div"
                                        min={1}
                                        max={64}
                                        step={1}
                                        def={1}
                                        onBandChange={setBandParam}
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
                                    onBandChange={setBandParam}
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
                                    onBandChange={setBandParam}
                                />
                            ) : null}
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'filter' ? (
                    <Stack gap={3}>
                        <Row gap={2}>
                            <BChip
                                active={Boolean(band.filterEnabled)}
                                onClick={() => setBandParam('filterEnabled', !band.filterEnabled)}
                            >
                                Enabled
                            </BChip>
                            <Row wrap gap={1}>
                                {FILTER_MODES.map((mode) => (
                                    <BChip
                                        key={mode}
                                        active={band.filterMode === mode}
                                        onClick={() => setBandParam('filterMode', mode)}
                                    >
                                        {mode}
                                    </BChip>
                                ))}
                            </Row>
                        </Row>

                        <Row wrap gap={4}>
                            <K
                                v={band.filterCutoff}
                                k="filterCutoff"
                                label="Cutoff"
                                min={20}
                                max={20000}
                                step={1}
                                def={8000}
                                unit="Hz"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.filterResonance}
                                k="filterResonance"
                                label="Reso"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.3}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.filterEnvAmount}
                                k="filterEnvAmount"
                                label="Env"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0}
                                onBandChange={setBandParam}
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
                                onBandChange={setBandParam}
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
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'chorus' ? (
                    <Stack gap={3}>
                        <BChip
                            active={Boolean(band.chorusEnabled)}
                            onClick={() => setBandParam('chorusEnabled', !band.chorusEnabled)}
                        >
                            Enabled
                        </BChip>
                        <Row wrap gap={4}>
                            <K
                                v={band.chorusRate}
                                k="chorusRate"
                                label="Rate"
                                min={0.01}
                                max={20}
                                step={0.01}
                                def={1.5}
                                unit="Hz"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.chorusDepth}
                                k="chorusDepth"
                                label="Depth"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.4}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.chorusFeedback}
                                k="chorusFeedback"
                                label="Feed"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0.2}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.chorusMix}
                                k="chorusMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'phaser' ? (
                    <Stack gap={3}>
                        <BChip
                            active={Boolean(band.phaserEnabled)}
                            onClick={() => setBandParam('phaserEnabled', !band.phaserEnabled)}
                        >
                            Enabled
                        </BChip>
                        <Row wrap gap={4}>
                            <K
                                v={band.phaserRate}
                                k="phaserRate"
                                label="Rate"
                                min={0.01}
                                max={10}
                                step={0.01}
                                def={0.5}
                                unit="Hz"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.phaserDepth}
                                k="phaserDepth"
                                label="Depth"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.7}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.phaserFeedback}
                                k="phaserFeedback"
                                label="Feed"
                                min={-1}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.phaserMix}
                                k="phaserMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'granular' ? (
                    <Stack gap={3}>
                        <Row gap={2}>
                            <BChip
                                active={Boolean(band.granularEnabled)}
                                onClick={() => setBandParam('granularEnabled', !band.granularEnabled)}
                            >
                                Enabled
                            </BChip>
                            <BChip
                                active={Boolean(band.grainFreeze)}
                                onClick={() => setBandParam('grainFreeze', !band.grainFreeze)}
                            >
                                Freeze
                            </BChip>
                        </Row>
                        <Row wrap gap={4}>
                            <K
                                v={band.grainSize}
                                k="grainSize"
                                label="Size"
                                min={10}
                                max={500}
                                step={1}
                                def={80}
                                unit="ms"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.grainDensity}
                                k="grainDensity"
                                label="Density"
                                min={1}
                                max={100}
                                step={1}
                                def={15}
                                onBandChange={setBandParam}
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
                                onBandChange={setBandParam}
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
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.grainMix}
                                k="grainMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'spectral' ? (
                    <Stack gap={3}>
                        <Row gap={2}>
                            <BChip
                                active={Boolean(band.spectralEnabled)}
                                onClick={() => setBandParam('spectralEnabled', !band.spectralEnabled)}
                            >
                                Enabled
                            </BChip>
                            <BChip
                                active={Boolean(band.spectralFreeze)}
                                onClick={() => setBandParam('spectralFreeze', !band.spectralFreeze)}
                            >
                                Freeze
                            </BChip>
                        </Row>
                        <Row wrap gap={4}>
                            <K
                                v={band.spectralBlur}
                                k="spectralBlur"
                                label="Blur"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.spectralMix}
                                k="spectralMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'freqShift' ? (
                    <Stack gap={3}>
                        <BChip
                            active={Boolean(band.freqShiftEnabled)}
                            onClick={() => setBandParam('freqShiftEnabled', !band.freqShiftEnabled)}
                        >
                            Enabled
                        </BChip>
                        <Row wrap gap={4}>
                            <K
                                v={band.freqShiftHz}
                                k="freqShiftHz"
                                label="Shift"
                                min={-1000}
                                max={1000}
                                step={0.1}
                                def={0}
                                unit="Hz"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.freqShiftMix}
                                k="freqShiftMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'lofi' ? (
                    <Stack gap={3}>
                        <BChip
                            active={Boolean(band.lofiEnabled)}
                            onClick={() => setBandParam('lofiEnabled', !band.lofiEnabled)}
                        >
                            Enabled
                        </BChip>
                        <Row wrap gap={4}>
                            <K
                                v={band.lofiAmount}
                                k="lofiAmount"
                                label="Amount"
                                min={0}
                                max={100}
                                step={1}
                                def={0}
                                unit="%"
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.codecArtifact}
                                k="codecArtifact"
                                label="Codec"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}

                {activeModule === 'convolution' ? (
                    <Stack gap={3}>
                        <BChip
                            active={Boolean(band.convolutionEnabled)}
                            onClick={() => setBandParam('convolutionEnabled', !band.convolutionEnabled)}
                        >
                            Enabled
                        </BChip>
                        <Row wrap gap={4}>
                            <K
                                v={band.convolutionMix}
                                k="convolutionMix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.3}
                                onBandChange={setBandParam}
                            />
                            <K
                                v={band.convolutionSeparation}
                                k="convolutionSeparation"
                                label="Spread"
                                min={0}
                                max={1}
                                step={0.01}
                                def={0.5}
                                onBandChange={setBandParam}
                            />
                        </Row>
                    </Stack>
                ) : null}
            </Stack>
            <Stack gap={3} className="bacteria-window p-3">
                <SectionHeader
                    eyebrow="Quick modulation"
                    title="Fast movers"
                    description="Enough motion control to shape the active mutation without going full bench mode."
                />
                <Row align="stretch" wrap gap={4}>
                    <K
                        deviceId={deviceId}
                        v={patch.lfo1Rate}
                        k="lfo1Rate"
                        label="LFO 1"
                        min={0.01}
                        max={40}
                        step={0.01}
                        def={2}
                        unit="Hz"
                    />
                    <K
                        deviceId={deviceId}
                        v={patch.lfo1Amount}
                        k="lfo1Amount"
                        label="LFO Amt"
                        min={0}
                        max={1}
                        step={0.01}
                        def={0.5}
                    />
                    <K
                        deviceId={deviceId}
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
                        deviceId={deviceId}
                        v={patch.envFollowerRelease}
                        k="envFollowerRelease"
                        label="Env Rel"
                        min={1}
                        max={2000}
                        step={1}
                        def={200}
                        unit="ms"
                    />
                </Row>
            </Stack>
        </Stack>
    );
}

const BuildDeck = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => (
    <Stack gap={2.5} className="h-full min-h-0 overflow-y-auto p-2.5">
        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="Split"
                title="Crossover controls"
                description="Keep the lane count and slope close at hand."
            />
            <Row wrap gap={2}>
                {[1, 2, 3, 4, 5, 6].map((count) => (
                    <BChip
                        key={count}
                        active={state.patch.bandCount === count}
                        onClick={() => {
                            setGlobalParam(deviceId, 'bandCount', count);
                            if (state.activeBand >= count) {
                                setBacteriaActiveBand(deviceId, count - 1);
                            }
                        }}
                    >
                        {count} band{count === 1 ? '' : 's'}
                    </BChip>
                ))}
            </Row>
            <Row wrap gap={2}>
                {['12', '24', '36', '48'].map((slope, index) => (
                    <BChip
                        key={slope}
                        active={state.patch.crossoverSlope === index}
                        onClick={() => setGlobalParam(deviceId, 'crossoverSlope', index)}
                    >
                        {slope} dB
                    </BChip>
                ))}
            </Row>
            <Row wrap gap={2}>
                {(['lr4', 'linear-phase'] as const).map((mode) => (
                    <BChip
                        key={mode}
                        active={state.patch.crossoverMode === mode}
                        onClick={() => setBacteriaParamWithAudio(deviceId, 'crossoverMode', mode)}
                    >
                        {mode === 'lr4' ? 'LR4' : 'Linear'}
                    </BChip>
                ))}
            </Row>
        </Stack>

        <Stack grow gap={2} className="bacteria-window min-h-0 overflow-y-auto p-3">
            <SectionHeader
                eyebrow="Modulation"
                title="Source dock"
                description="Still compact, still visible, and less stranded than before."
            />
            <ModulationDock patch={state.patch} modValues={[]} onAssignmentRemove={() => {}} />
        </Stack>
    </Stack>
);

const RouteDeck = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => (
    <Stack gap={2.5} className="h-full min-h-0 overflow-y-auto p-2.5">
        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="Global"
                title="Routing mode"
                description="Choose how the bands behave before you dive into the per-band overrides."
            />
            <Row wrap gap={2}>
                {ROUTING_MODES.map((mode) => {
                    let modeLabel = 'Mid/side';
                    if (mode === 'serial') {
                        modeLabel = 'Serial';
                    } else if (mode === 'parallel') {
                        modeLabel = 'Parallel';
                    }

                    return (
                        <BChip
                            key={mode}
                            active={state.patch.globalRouting === mode}
                            onClick={() => setBacteriaParamWithAudio(deviceId, 'globalRouting', mode)}
                        >
                            {modeLabel}
                        </BChip>
                    );
                })}
            </Row>
        </Stack>

        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="Per band"
                title="Lane overrides"
                description="Useful when one band needs to misbehave on its own."
            />
            <Stack gap={2}>
                {Array.from({ length: state.patch.bandCount }, (_, index) => (
                    <Row key={index} justify="between" gap={3} className="bacteria-window px-3 py-2">
                        <span className="text-[11px] font-medium text-foreground">Band {index + 1}</span>
                        <Row wrap gap={1}>
                            {ROUTING_MODES.map((mode) => (
                                <BChip
                                    key={mode}
                                    active={state.patch.bands[index]?.routingMode === mode}
                                    onClick={() => setBacteriaBandParamWithAudio(deviceId, index, 'routingMode', mode)}
                                >
                                    {mode === 'mid-side' ? 'M/S' : mode}
                                </BChip>
                            ))}
                        </Row>
                    </Row>
                ))}
            </Stack>
        </Stack>
    </Stack>
);

const LabDeck = ({ deviceId, state }: { deviceId: string; state: BacteriaState }): ReactElement => (
    <Stack gap={2.5} className="h-full min-h-0 overflow-y-auto p-2.5">
        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="LFOs"
                title="Motion core"
                description="Rates and shapes for the built-in wigglers."
            />
            <Row wrap gap={4}>
                <K
                    deviceId={deviceId}
                    v={state.patch.lfo1Rate}
                    k="lfo1Rate"
                    label="LFO 1"
                    min={0.01}
                    max={40}
                    step={0.01}
                    def={2}
                    unit="Hz"
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lfo1Amount}
                    k="lfo1Amount"
                    label="Amt 1"
                    min={0}
                    max={1}
                    step={0.01}
                    def={0.5}
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lfo2Rate}
                    k="lfo2Rate"
                    label="LFO 2"
                    min={0.01}
                    max={40}
                    step={0.01}
                    def={0.5}
                    unit="Hz"
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lfo2Amount}
                    k="lfo2Amount"
                    label="Amt 2"
                    min={0}
                    max={1}
                    step={0.01}
                    def={0.5}
                />
            </Row>
            <Row wrap gap={2}>
                {['Sin', 'Tri', 'Saw', 'Sq', 'S&H'].map((shape, index) => (
                    <BChip
                        key={`lfo1-${shape}`}
                        active={state.patch.lfo1Shape === index}
                        onClick={() => setGlobalParam(deviceId, 'lfo1Shape', index)}
                    >
                        LFO1 {shape}
                    </BChip>
                ))}
            </Row>
            <Row wrap gap={2}>
                {['Sin', 'Tri', 'Saw', 'Sq', 'S&H'].map((shape, index) => (
                    <BChip
                        key={`lfo2-${shape}`}
                        active={state.patch.lfo2Shape === index}
                        onClick={() => setGlobalParam(deviceId, 'lfo2Shape', index)}
                    >
                        LFO2 {shape}
                    </BChip>
                ))}
            </Row>
        </Stack>

        <Stack gap={3} className="bacteria-window p-3">
            <SectionHeader
                eyebrow="Followers"
                title="Bench controls"
                description="Envelope, Lorenz, and steps in one place."
            />
            <Row wrap gap={4}>
                <K
                    deviceId={deviceId}
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
                    deviceId={deviceId}
                    v={state.patch.envFollowerRelease}
                    k="envFollowerRelease"
                    label="Env Rel"
                    min={1}
                    max={2000}
                    step={1}
                    def={200}
                    unit="ms"
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.stepSeqSteps}
                    k="stepSeqSteps"
                    label="Steps"
                    min={1}
                    max={32}
                    step={1}
                    def={16}
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.stepSeqRate}
                    k="stepSeqRate"
                    label="Step Hz"
                    min={0.5}
                    max={32}
                    step={0.5}
                    def={4}
                    unit="Hz"
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lorenzSigma}
                    k="lorenzSigma"
                    label="Sigma"
                    min={1}
                    max={30}
                    step={0.1}
                    def={10}
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lorenzRho}
                    k="lorenzRho"
                    label="Rho"
                    min={1}
                    max={50}
                    step={0.1}
                    def={28}
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lorenzBeta}
                    k="lorenzBeta"
                    label="Beta"
                    min={0.1}
                    max={10}
                    step={0.01}
                    def={2.667}
                />
                <K
                    deviceId={deviceId}
                    v={state.patch.lorenzSpeed}
                    k="lorenzSpeed"
                    label="Speed"
                    min={0.01}
                    max={10}
                    step={0.01}
                    def={1}
                />
            </Row>
        </Stack>
    </Stack>
);

function renderHero(deviceId: string, state: BacteriaState): ReactElement {
    if (state.uiLevel === 1) {
        return <PlayHero deviceId={deviceId} state={state} />;
    }
    if (state.uiLevel === 2) {
        return <ShapeHero deviceId={deviceId} state={state} />;
    }
    if (state.uiLevel === 3) {
        return <BuildHero deviceId={deviceId} state={state} />;
    }
    if (state.uiLevel === 4) {
        return <RouteHero state={state} />;
    }
    return <LabHero state={state} />;
}

function renderDeck(deviceId: string, state: BacteriaState): ReactElement {
    if (state.uiLevel === 1) {
        return <PlayDeck deviceId={deviceId} state={state} />;
    }
    if (state.uiLevel === 2) {
        return renderShapeControls(deviceId, state);
    }
    if (state.uiLevel === 3) {
        return <BuildDeck deviceId={deviceId} state={state} />;
    }
    if (state.uiLevel === 4) {
        return <RouteDeck deviceId={deviceId} state={state} />;
    }
    return <LabDeck deviceId={deviceId} state={state} />;
}

export const BacteriaPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const allInstances = useStore(bacteriaStore, {});
    const state: BacteriaState = allInstances?.[deviceId] ?? getBacteriaState(deviceId);
    const [presetQuery, setPresetQuery] = useState('');
    const [presetCategory, setPresetCategory] = useState('All');
    const [, startFilterTransition] = useTransition();

    const activeLevel = getActiveLevel(state.uiLevel);
    const activeBand = state.patch.bands[state.activeBand] ?? state.patch.bands[0]!;
    const moduleMeta = getModuleMeta(state.activeModule);

    return (
        <Row className="bacteria-faceplate h-full min-h-0 gap-2.5 p-2.5">
            <PresetRail
                deviceId={deviceId}
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

            <Stack gap={2.5} grow className="min-w-0">
                <Row as="header" gap={2.5} className="bacteria-window shrink-0 flex-wrap px-3 py-2">
                    <Stack gap={1}>
                        <div className="text-[8px] uppercase tracking-[0.28em] text-[var(--color-accent-mint-bright)]/70">
                            {activeLevel.eyebrow}
                        </div>
                        <div className="text-[13px] font-semibold text-foreground">Bacteria</div>
                    </Stack>

                    <Row wrap gap={1.5}>
                        {LEVELS.map((level) => {
                            const active = level.id === state.uiLevel;

                            return (
                                <BChip
                                    key={level.id}
                                    active={active}
                                    title={level.description}
                                    onClick={() => setBacteriaUiLevel(deviceId, level.id)}
                                >
                                    {level.label}
                                </BChip>
                            );
                        })}
                    </Row>

                    {state.uiLevel >= 2 ? (
                        <Row wrap gap={1}>
                            {Array.from({ length: state.patch.bandCount }, (_, index) => (
                                <BChip
                                    key={index}
                                    active={state.activeBand === index}
                                    onClick={() => setBacteriaActiveBand(deviceId, index)}
                                >
                                    Band {index + 1}
                                </BChip>
                            ))}
                        </Row>
                    ) : null}

                    <Row gap={2} className="ml-auto">
                        <DawPluginLed tone="mint">{moduleMeta.label}</DawPluginLed>
                        <Stack align="end" className="text-right">
                            <div className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/55">
                                In {formatValue(state.inputDb, 'dB')} / Out {formatValue(state.outputDb, 'dB')}
                            </div>
                            <div className="text-[10px] text-muted-foreground">
                                {countEnabledEffects(activeBand)} active effects in band {state.activeBand + 1}
                            </div>
                        </Stack>
                        <BChip
                            active={Boolean(state.patch.bypass)}
                            onClick={() => setBacteriaParamWithAudio(deviceId, 'bypass', !state.patch.bypass)}
                        >
                            {state.patch.bypass ? 'Bypassed' : 'Live'}
                        </BChip>
                    </Row>
                </Row>

                <Grid cols={2} gap={2.5} className="min-h-0 flex-1 grid-cols-[minmax(0,1.45fr)_minmax(320px,0.92fr)]">
                    <section className="bacteria-window min-h-0 overflow-hidden">{renderHero(deviceId, state)}</section>
                    <section className="bacteria-window min-h-0 overflow-hidden">{renderDeck(deviceId, state)}</section>
                </Grid>

                <Grid gap={2.5} className="shrink-0 grid-cols-[repeat(4,minmax(0,auto))_minmax(0,1fr)]">
                    <MetricCell label="Input" value={formatValue(state.inputDb, 'dB')} />
                    <MetricCell label="Output" value={formatValue(state.outputDb, 'dB')} />
                    <MetricCell label="Latency" value={state.latency > 0 ? `${state.latency} smp` : '0 smp'} />
                    <MetricCell label="Active band" value={`B${state.activeBand + 1}`} />
                    <BandMeters state={state} />
                </Grid>
            </Stack>
        </Row>
    );
};
