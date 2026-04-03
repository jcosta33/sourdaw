import { type ReactElement, type ReactNode, useState, useSyncExternalStore } from 'react';
import { Activity, Flame, Radio, Search, SlidersHorizontal, Sun, Zap } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { type GlutenPatch, type GlutenStyle, type GlutenTopology } from '../../models/GlutenPatch';
import { glutenStore, type GlutenState } from '../../stores/glutenStore';
import { GLUTEN_PRESETS } from '../../useCases/glutenPresets';
import { loadGlutenPatchWithAudio, setGlutenParamWithAudio } from '../../useCases/glutenParamBridge';
import { GlutenCurve } from '../components/GlutenCurve';
import { GrHistory } from '../components/GrHistory';
import { GrMeter } from '../components/GrMeter';

const TOPOLOGY_META: Record<
    GlutenTopology,
    {
        label: string;
        icon: typeof Zap;
        color: string;
        description: string;
        detail: string;
    }
> = {
    vca: {
        label: 'VCA',
        icon: Zap,
        color: 'var(--color-accent-peach)',
        description: 'Clean glue and disciplined pull.',
        detail: 'Bus duty',
    },
    opto: {
        label: 'Opto',
        icon: Sun,
        color: 'var(--color-accent-mint)',
        description: 'Slow glow and easy leveling.',
        detail: 'Settle',
    },
    fet: {
        label: 'FET',
        icon: Flame,
        color: 'var(--color-state-danger)',
        description: 'Fast grab with extra bark.',
        detail: 'Snap',
    },
    diode: {
        label: 'Diode',
        icon: Radio,
        color: 'var(--color-accent-lavender)',
        description: 'Dense, thick, and a little stern.',
        detail: 'Weight',
    },
};

const STYLE_META: Record<
    GlutenStyle,
    {
        label: string;
        description: string;
        detail: string;
    }
> = {
    glue: {
        label: 'Glue',
        description: 'Even-handed bus squeeze.',
        detail: 'Hold it together',
    },
    punch: {
        label: 'Punch',
        description: 'Faster grip and more poke.',
        detail: 'Grab the front',
    },
    smooth: {
        label: 'Smooth',
        description: 'Gentle leveling without fuss.',
        detail: 'Let it settle',
    },
    pump: {
        label: 'Pump',
        description: 'Longer release and audible motion.',
        detail: 'Lean into it',
    },
};

const STYLE_PATCHES: Record<GlutenStyle, Partial<GlutenPatch>> = {
    glue: {
        style: 'glue',
        topology: 'vca',
        threshold: -18,
        ratio: 4,
        attack: 10,
        release: 300,
        autoRelease: true,
        knee: 6,
        range: 15,
        mix: 1,
    },
    punch: {
        style: 'punch',
        topology: 'fet',
        threshold: -20,
        ratio: 8,
        attack: 0.2,
        release: 250,
        autoRelease: false,
        mix: 1,
    },
    smooth: {
        style: 'smooth',
        topology: 'opto',
        threshold: -25,
        ratio: 3,
        attack: 20,
        release: 500,
        autoRelease: true,
        mix: 1,
    },
    pump: {
        style: 'pump',
        topology: 'vca',
        threshold: -15,
        ratio: 4,
        attack: 0.5,
        release: 800,
        autoRelease: false,
        knee: 3,
        range: 20,
        mix: 1,
    },
};

const TOPOLOGIES: GlutenTopology[] = ['vca', 'opto', 'fet', 'diode'];
const STYLES: GlutenStyle[] = ['glue', 'punch', 'smooth', 'pump'];
const CATEGORIES = ['all', ...new Set(GLUTEN_PRESETS.map((preset) => preset.category))];

function formatValue(value: number, unit?: string): string {
    if (!unit) {
        return `${value.toFixed(2)}`;
    }

    if (unit === 'dB') {
        return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    }

    if (unit === ':1') {
        if (value >= 20) {
            return '∞:1';
        }
        return `${value.toFixed(1)}:1`;
    }

    if (unit === 'mix') {
        return `${Math.round(value * 100)}%`;
    }

    if (unit === 'link') {
        return `${Math.round(value * 100)}%`;
    }

    if (unit === 'ms') {
        if (value < 1) {
            return `${(value * 1000).toFixed(0)} µs`;
        }
        if (value >= 1000) {
            return `${(value / 1000).toFixed(2)} s`;
        }
        return `${value.toFixed(0)} ms`;
    }

    if (unit === 'Hz') {
        if (value >= 1000) {
            return `${(value / 1000).toFixed(1)} kHz`;
        }
        return `${value.toFixed(0)} Hz`;
    }

    return `${value.toFixed(2)} ${unit}`;
}

function normalize(value: number, min: number, max: number): number {
    return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function describePreset(patch: GlutenPatch): string {
    const topologyLabel = TOPOLOGY_META[patch.topology].label;
    return `${topologyLabel} · ${formatValue(patch.ratio, ':1')} · ${formatValue(patch.threshold, 'dB')}`;
}

function buildStylePatch(style: GlutenStyle, patch: GlutenPatch): GlutenPatch {
    return {
        ...patch,
        ...STYLE_PATCHES[style],
        style,
    };
}

const MetricTile = ({ label, value, detail }: { label: string; value: string; detail: string }): ReactElement => (
    <div className="gluten-window flex min-w-[90px] flex-col gap-1 px-3 py-2">
        <span className="text-[8px] uppercase tracking-[0.24em] text-muted-foreground/55">{label}</span>
        <span className="font-mono text-[13px] text-foreground">{value}</span>
        <span className="text-[9px] leading-4 text-muted-foreground/55">{detail}</span>
    </div>
);

const LensBar = ({
    label,
    value,
    accentColor,
}: {
    label: string;
    value: number;
    accentColor: string;
}): ReactElement => (
    <div className="space-y-1">
        <div className="flex items-center justify-between gap-2 text-[9px] text-muted-foreground">
            <span>{label}</span>
            <span className="font-mono text-[8px] text-foreground/80">{Math.round(value * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full bg-white/6">
            <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(value * 100)}%`, backgroundColor: accentColor }}
            />
        </div>
    </div>
);

const ControlCard = ({
    title,
    detail,
    children,
}: {
    title: string;
    detail?: string;
    children: ReactNode;
}): ReactElement => (
    <section className="gluten-window flex flex-col gap-3 p-3">
        <div className="flex items-center justify-between gap-3">
            <div className="space-y-1">
                <div className="text-[8px] font-semibold uppercase tracking-[0.24em] text-[var(--color-accent-peach)]/68">
                    {title}
                </div>
                {detail ? <span className="sr-only">{detail}</span> : null}
            </div>
        </div>
        {children}
    </section>
);

const ToggleChip = ({
    label,
    active,
    accentColor,
    onClick,
}: {
    label: string;
    active: boolean;
    accentColor: string;
    onClick: () => void;
}): ReactElement => (
    <button
        type="button"
        className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
        style={active ? { borderColor: accentColor, color: accentColor } : undefined}
        onClick={onClick}
    >
        {label}
    </button>
);

const Knob = ({
    value,
    param,
    label,
    min,
    max,
    step,
    defaultValue,
    unit,
}: {
    value: number;
    param: keyof GlutenPatch;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    unit?: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-1">
        <RotaryKnob
            value={value}
            onChange={(nextValue) => setGlutenParamWithAudio(param, nextValue as GlutenPatch[typeof param])}
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{formatValue(value, unit)}</div>
        </div>
    </div>
);

export const GlutenPanel = (): ReactElement => {
    const state = useSyncExternalStore<GlutenState | null>(
        (callback) => glutenStore.subscribe(callback),
        () => glutenStore.value
    );
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');

    const patch = state?.patch ?? glutenStore.value?.patch;
    if (!patch) {
        return <div className="h-full" />;
    }
    const currentPatch = patch;

    const grDb = state?.grDb ?? 0;
    const inputDb = state?.inputDb ?? -100;
    const outputDb = state?.outputDb ?? -100;
    const crest = state?.crest ?? 0;
    const phaseCorr = state?.phaseCorr ?? 1;
    const latency = state?.latency ?? 0;

    const searchTerm = search.trim().toLowerCase();
    const filteredPresets = GLUTEN_PRESETS.filter((preset) => {
        const matchesCategory = category === 'all' ? true : preset.category === category;
        const matchesSearch =
            searchTerm.length === 0 ? true : `${preset.name} ${preset.category}`.toLowerCase().includes(searchTerm);
        return matchesCategory && matchesSearch;
    });

    const topologyMeta = TOPOLOGY_META[currentPatch.topology];
    const accentColor = topologyMeta.color;
    const stageTwoOptions = TOPOLOGIES.filter((topology) => topology !== currentPatch.topology);

    function applyPreset(nextPatch: GlutenPatch): void {
        loadGlutenPatchWithAudio(nextPatch);
    }

    function applyStyle(style: GlutenStyle): void {
        applyPreset(buildStylePatch(style, currentPatch));
    }

    return (
        <div className="gluten-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_19rem] gap-3">
                <aside className="gluten-window flex min-h-0 flex-col gap-3 p-3">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-1">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/68">
                                Presets
                            </div>
                            <div className="text-[15px] font-semibold text-foreground">Gluten</div>
                        </div>
                        <div className="gluten-led">{filteredPresets.length} ready</div>
                    </div>

                    <label className="gluten-window flex items-center gap-2 px-3 py-2">
                        <Search className="size-3.5 text-muted-foreground/55" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Find a squeeze"
                            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/45"
                            aria-label="Search Gluten presets"
                        />
                    </label>

                    <div className="flex flex-wrap gap-1.5">
                        {CATEGORIES.map((entry) => {
                            const active = category === entry;
                            return (
                                <button
                                    key={entry}
                                    type="button"
                                    className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                    onClick={() => setCategory(entry)}
                                >
                                    {entry === 'all' ? 'All' : entry}
                                </button>
                            );
                        })}
                    </div>

                    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                        {filteredPresets.length > 0 ? (
                            filteredPresets.map((preset) => {
                                const active = preset.patch.name === patch.name;
                                return (
                                    <button
                                        key={preset.id}
                                        type="button"
                                        className={`gluten-window flex flex-col items-start gap-1 px-3 py-2 text-left transition-all ${
                                            active
                                                ? 'border-white/18 bg-white/[0.03]'
                                                : 'hover:border-white/12 hover:bg-white/[0.02]'
                                        }`}
                                        onClick={() => applyPreset(preset.patch)}
                                    >
                                        <div className="flex w-full items-center justify-between gap-2">
                                            <span className="text-[11px] font-medium text-foreground">
                                                {preset.name}
                                            </span>
                                            <span className="text-[8px] uppercase tracking-[0.22em] text-muted-foreground/45">
                                                {preset.category}
                                            </span>
                                        </div>
                                        <span className="text-[9px] leading-4 text-muted-foreground">
                                            {describePreset(preset.patch)}
                                        </span>
                                    </button>
                                );
                            })
                        ) : (
                            <div className="gluten-window flex flex-1 items-center justify-center px-4 py-6 text-center text-[11px] leading-5 text-muted-foreground">
                                No preset matches that search yet. Try another category or a looser word.
                            </div>
                        )}
                    </div>
                </aside>

                <section className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="flex items-start justify-between gap-3">
                        <div className="space-y-2">
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/68">
                                Dynamics cockpit
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{patch.name}</div>
                        </div>

                        <div className="flex flex-wrap justify-end gap-2">
                            <MetricTile
                                label="Grab"
                                value={`${Math.abs(grDb).toFixed(1)} dB`}
                                detail="Current gain reduction"
                            />
                            <MetricTile label="Crest" value={`${crest.toFixed(1)} dB`} detail="Transient spread" />
                            <MetricTile
                                label="Phase"
                                value={phaseCorr > 0.99 ? 'Mono' : phaseCorr < -0.99 ? 'OOP' : phaseCorr.toFixed(2)}
                                detail="Stereo correlation"
                            />
                            <MetricTile label="Latency" value={`${latency} smp`} detail="Lookahead cost" />
                        </div>
                    </div>

                    <div className="grid grid-cols-4 gap-2">
                        {TOPOLOGIES.map((topology) => {
                            const meta = TOPOLOGY_META[topology];
                            const Icon = meta.icon;
                            const active = patch.topology === topology;
                            return (
                                <button
                                    key={topology}
                                    type="button"
                                    className={`gluten-window flex flex-col items-start gap-2 px-3 py-2 text-left transition-all ${
                                        active
                                            ? 'border-white/18 bg-white/[0.035]'
                                            : 'hover:border-white/12 hover:bg-white/[0.02]'
                                    }`}
                                    style={active ? { borderColor: meta.color } : undefined}
                                    onClick={() => setGlutenParamWithAudio('topology', topology)}
                                >
                                    <div className="flex w-full items-center justify-between gap-3">
                                        <div className="flex items-center gap-2">
                                            <div
                                                className="rounded-full border border-white/10 p-1.5"
                                                style={{ color: meta.color }}
                                            >
                                                <Icon className="size-3.5" />
                                            </div>
                                            <div>
                                                <div className="text-[10px] font-semibold text-foreground">
                                                    {meta.label}
                                                </div>
                                                <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/42">
                                                    {meta.detail}
                                                </div>
                                            </div>
                                        </div>
                                        {active ? <div className="gluten-led">Live</div> : null}
                                    </div>
                                </button>
                            );
                        })}
                    </div>

                    <div className="gluten-window flex min-h-0 shrink-0 flex-col gap-3 p-3">
                        <div className="flex items-start justify-between gap-3">
                            <div className="space-y-1">
                                <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-peach)]/68">
                                    Quick moves
                                </div>
                                <div className="text-[13px] font-semibold text-foreground">
                                    {STYLE_META[patch.style].label}
                                </div>
                            </div>

                            <div className="flex flex-wrap justify-end gap-1.5">
                                {STYLES.map((style) => {
                                    const active = patch.style === style;
                                    return (
                                        <button
                                            key={style}
                                            type="button"
                                            className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                            onClick={() => applyStyle(style)}
                                        >
                                            {STYLE_META[style].label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_3.75rem] gap-3">
                            <div className="flex min-h-0 flex-col gap-3">
                                <div className="overflow-x-auto">
                                    <GlutenCurve
                                        threshold={patch.threshold}
                                        ratio={patch.ratio}
                                        knee={patch.knee}
                                        makeup={patch.makeup}
                                        grDb={grDb}
                                        inputDb={inputDb}
                                        width={360}
                                        height={180}
                                        onThresholdChange={(value) => setGlutenParamWithAudio('threshold', value)}
                                        accentColor={accentColor}
                                    />
                                </div>
                                <div className="overflow-x-auto">
                                    <GrHistory grDb={grDb} width={420} height={50} accentColor={accentColor} />
                                </div>
                                <div className="grid grid-cols-3 gap-2">
                                    <div className="gluten-window flex flex-col gap-2 px-3 py-2">
                                        <div className="flex items-center gap-2 text-[10px] font-medium text-foreground">
                                            <Activity className="size-3.5" style={{ color: accentColor }} />
                                            Detector lens
                                        </div>
                                        <LensBar
                                            label="Attack"
                                            value={normalize(patch.attack, 0.02, 250)}
                                            accentColor={accentColor}
                                        />
                                        <LensBar
                                            label="Release"
                                            value={normalize(patch.release, 25, 5000)}
                                            accentColor={accentColor}
                                        />
                                        <LensBar
                                            label="Knee"
                                            value={normalize(patch.knee, 0, 30)}
                                            accentColor={accentColor}
                                        />
                                    </div>
                                    <div className="gluten-window flex flex-col gap-2 px-3 py-2">
                                        <div className="flex items-center gap-2 text-[10px] font-medium text-foreground">
                                            <SlidersHorizontal className="size-3.5" style={{ color: accentColor }} />
                                            Sidechain
                                        </div>
                                        <LensBar
                                            label="HPF"
                                            value={normalize(patch.scHpfFreq, 20, 500)}
                                            accentColor={accentColor}
                                        />
                                        <LensBar
                                            label="LPF"
                                            value={normalize(patch.scLpfFreq, 1000, 20000)}
                                            accentColor={accentColor}
                                        />
                                        <LensBar label="Link" value={patch.stereoLink} accentColor={accentColor} />
                                    </div>
                                    <div className="gluten-window flex flex-col gap-2 px-3 py-2">
                                        <div className="flex items-center justify-between gap-2">
                                            <div className="text-[10px] font-medium text-foreground">Quick read</div>
                                            <div className="gluten-led">{topologyMeta.detail}</div>
                                        </div>
                                        <div className="space-y-1 text-[10px] leading-4 text-muted-foreground">
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Input</span>
                                                <span className="font-mono text-foreground/85">
                                                    {inputDb.toFixed(1)} dB
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Output</span>
                                                <span className="font-mono text-foreground/85">
                                                    {outputDb.toFixed(1)} dB
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Mode</span>
                                                <span className="font-mono text-foreground/85">
                                                    {patch.detection.toUpperCase()}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-between gap-2">
                                                <span>Story</span>
                                                <span className="font-mono text-foreground/85">
                                                    {STYLE_META[patch.style].detail}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>

                            <GrMeter
                                grDb={grDb}
                                inputDb={inputDb}
                                outputDb={outputDb}
                                width={54}
                                height={236}
                                accentColor={accentColor}
                            />
                        </div>
                    </div>
                </section>

                <aside className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
                    <ControlCard title="Clamp" detail="Threshold, ratio, and timing stay front and center.">
                        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                            <Knob
                                value={patch.threshold}
                                param="threshold"
                                label="Threshold"
                                min={-60}
                                max={0}
                                step={0.5}
                                defaultValue={-18}
                                unit="dB"
                            />
                            <Knob
                                value={patch.ratio}
                                param="ratio"
                                label="Ratio"
                                min={1}
                                max={20}
                                step={0.5}
                                defaultValue={4}
                                unit=":1"
                            />
                            <Knob
                                value={patch.knee}
                                param="knee"
                                label="Knee"
                                min={0}
                                max={30}
                                step={0.5}
                                defaultValue={6}
                                unit="dB"
                            />
                            <Knob
                                value={patch.attack}
                                param="attack"
                                label="Attack"
                                min={0.02}
                                max={250}
                                step={0.1}
                                defaultValue={10}
                                unit="ms"
                            />
                            <Knob
                                value={patch.release}
                                param="release"
                                label="Release"
                                min={25}
                                max={5000}
                                step={1}
                                defaultValue={300}
                                unit="ms"
                            />
                            <Knob
                                value={patch.amount}
                                param="amount"
                                label="Amount"
                                min={0}
                                max={100}
                                step={1}
                                defaultValue={50}
                            />
                        </div>
                    </ControlCard>

                    <ControlCard title="Finish" detail="Keep the lane honest while you blend and level.">
                        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                            <Knob
                                value={patch.makeup}
                                param="makeup"
                                label="Makeup"
                                min={-12}
                                max={24}
                                step={0.5}
                                defaultValue={0}
                                unit="dB"
                            />
                            <Knob
                                value={patch.mix}
                                param="mix"
                                label="Mix"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={1}
                                unit="mix"
                            />
                            <Knob
                                value={patch.range}
                                param="range"
                                label="Range"
                                min={0}
                                max={60}
                                step={1}
                                defaultValue={15}
                                unit="dB"
                            />
                            <Knob
                                value={patch.stereoLink}
                                param="stereoLink"
                                label="Link"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={1}
                                unit="link"
                            />
                            <Knob
                                value={patch.lookahead}
                                param="lookahead"
                                label="Look"
                                min={0}
                                max={20}
                                step={0.5}
                                defaultValue={0}
                                unit="ms"
                            />
                            <Knob
                                value={patch.blendAmount}
                                param="blendAmount"
                                label="Stage 2"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                unit="mix"
                            />
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                            <ToggleChip
                                label="Auto rel"
                                active={patch.autoRelease}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio('autoRelease', !patch.autoRelease)}
                            />
                            <ToggleChip
                                label="Auto gain"
                                active={patch.autoMakeup}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio('autoMakeup', !patch.autoMakeup)}
                            />
                            <ToggleChip
                                label="Delta"
                                active={patch.deltaListen}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio('deltaListen', !patch.deltaListen)}
                            />
                            <ToggleChip
                                label="Match"
                                active={patch.gainMatchBypass}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio('gainMatchBypass', !patch.gainMatchBypass)}
                            />
                        </div>
                    </ControlCard>

                    <ControlCard
                        title="Detector"
                        detail="Sidechain filters and listen modes live together instead of hiding in the header."
                    >
                        <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                            <Knob
                                value={patch.scHpfFreq}
                                param="scHpfFreq"
                                label="SC HPF"
                                min={20}
                                max={500}
                                step={1}
                                defaultValue={80}
                                unit="Hz"
                            />
                            <Knob
                                value={patch.scLpfFreq}
                                param="scLpfFreq"
                                label="SC LPF"
                                min={1000}
                                max={20000}
                                step={100}
                                defaultValue={20000}
                                unit="Hz"
                            />
                            <Knob
                                value={patch.scEqFreq}
                                param="scEqFreq"
                                label="SC EQ"
                                min={20}
                                max={20000}
                                step={10}
                                defaultValue={1000}
                                unit="Hz"
                            />
                            <Knob
                                value={patch.scEqGain}
                                param="scEqGain"
                                label="EQ Gain"
                                min={-18}
                                max={18}
                                step={0.5}
                                defaultValue={0}
                                unit="dB"
                            />
                            <Knob
                                value={patch.scEqQ}
                                param="scEqQ"
                                label="EQ Q"
                                min={0.1}
                                max={10}
                                step={0.1}
                                defaultValue={1}
                            />
                            <Knob
                                value={patch.oversampling}
                                param="oversampling"
                                label="OS"
                                min={1}
                                max={4}
                                step={1}
                                defaultValue={2}
                            />
                        </div>
                        <div className="space-y-2">
                            <div className="flex flex-wrap gap-1.5">
                                <ToggleChip
                                    label="HPF"
                                    active={patch.scHpfEnabled}
                                    accentColor={accentColor}
                                    onClick={() => setGlutenParamWithAudio('scHpfEnabled', !patch.scHpfEnabled)}
                                />
                                <ToggleChip
                                    label="LPF"
                                    active={patch.scLpfEnabled}
                                    accentColor={accentColor}
                                    onClick={() => setGlutenParamWithAudio('scLpfEnabled', !patch.scLpfEnabled)}
                                />
                                <ToggleChip
                                    label="SC EQ"
                                    active={patch.scEqEnabled}
                                    accentColor={accentColor}
                                    onClick={() => setGlutenParamWithAudio('scEqEnabled', !patch.scEqEnabled)}
                                />
                                <ToggleChip
                                    label="Ext SC"
                                    active={patch.extSidechain}
                                    accentColor={accentColor}
                                    onClick={() => setGlutenParamWithAudio('extSidechain', !patch.extSidechain)}
                                />
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {(['rms', 'peak'] as const).map((mode) => {
                                    const active = patch.detection === mode;
                                    return (
                                        <button
                                            key={mode}
                                            type="button"
                                            className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                            onClick={() => setGlutenParamWithAudio('detection', mode)}
                                        >
                                            {mode.toUpperCase()}
                                        </button>
                                    );
                                })}
                                {(['stereo', 'mid', 'side', 'dual-mono'] as const).map((mode) => {
                                    const active = patch.stereoMode === mode;
                                    return (
                                        <button
                                            key={mode}
                                            type="button"
                                            className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                            onClick={() => setGlutenParamWithAudio('stereoMode', mode)}
                                        >
                                            {mode === 'dual-mono' ? 'Dual mono' : mode}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                                {[0, 1, 2].map((thrust) => {
                                    const labels = ['Thrust off', 'Thrust med', 'Thrust loud'];
                                    const active = patch.thrust === thrust;
                                    return (
                                        <button
                                            key={thrust}
                                            type="button"
                                            className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                            onClick={() => setGlutenParamWithAudio('thrust', thrust)}
                                        >
                                            {labels[thrust]}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </ControlCard>

                    <ControlCard title="Character" detail="The last mile changes with the topology you picked.">
                        {patch.topology === 'fet' ? (
                            <div className="grid grid-cols-3 gap-x-2 gap-y-3">
                                <Knob
                                    value={patch.inputGain}
                                    param="inputGain"
                                    label="Input"
                                    min={-12}
                                    max={24}
                                    step={0.5}
                                    defaultValue={0}
                                    unit="dB"
                                />
                                <Knob
                                    value={patch.outputGain}
                                    param="outputGain"
                                    label="Output"
                                    min={-24}
                                    max={24}
                                    step={0.5}
                                    defaultValue={0}
                                    unit="dB"
                                />
                                <Knob
                                    value={patch.xfmrDrive}
                                    param="xfmrDrive"
                                    label="Xfmr"
                                    min={0}
                                    max={3}
                                    step={0.01}
                                    defaultValue={1.2}
                                />
                                <Knob
                                    value={patch.jfetK3}
                                    param="jfetK3"
                                    label="Odd"
                                    min={0}
                                    max={0.5}
                                    step={0.01}
                                    defaultValue={0.15}
                                />
                                <Knob
                                    value={patch.xfmrK2}
                                    param="xfmrK2"
                                    label="Even"
                                    min={0}
                                    max={0.3}
                                    step={0.01}
                                    defaultValue={0}
                                />
                                <div className="col-span-3">
                                    <ToggleChip
                                        label="All buttons"
                                        active={patch.allButtons}
                                        accentColor={accentColor}
                                        onClick={() => setGlutenParamWithAudio('allButtons', !patch.allButtons)}
                                    />
                                </div>
                            </div>
                        ) : null}

                        {patch.topology === 'opto' ? (
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {[false, true].map((mode, index) => {
                                        const labels = ['Compress', 'Limit'];
                                        const active = patch.limitMode === mode;
                                        return (
                                            <button
                                                key={labels[index]}
                                                type="button"
                                                className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                                onClick={() => setGlutenParamWithAudio('limitMode', mode)}
                                            >
                                                {labels[index]}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] leading-4 text-muted-foreground">
                                    Limit leans harder on the cell. Compress lets it breathe.
                                </p>
                            </div>
                        ) : null}

                        {patch.topology === 'diode' ? (
                            <div className="space-y-2">
                                <div className="flex flex-wrap gap-1.5">
                                    {[1, 2, 3, 4, 5].map((value) => {
                                        const active = patch.recovery === value;
                                        return (
                                            <button
                                                key={value}
                                                type="button"
                                                className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                                onClick={() => setGlutenParamWithAudio('recovery', value)}
                                            >
                                                Recovery {value}
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[10px] leading-4 text-muted-foreground">
                                    Lower values grab harder. Higher values relax into the tail.
                                </p>
                            </div>
                        ) : null}

                        {patch.topology === 'vca' ? (
                            <div className="space-y-3">
                                <div className="grid grid-cols-2 gap-2">
                                    <Knob
                                        value={patch.vcaCharacter}
                                        param="vcaCharacter"
                                        label="Color"
                                        min={0}
                                        max={0.02}
                                        step={0.001}
                                        defaultValue={0.003}
                                    />
                                    <Knob
                                        value={patch.vcaType}
                                        param="vcaType"
                                        label="VCA type"
                                        min={0}
                                        max={2}
                                        step={1}
                                        defaultValue={1}
                                    />
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                    {[false, true].map((mode, index) => {
                                        const labels = ['Feedback', 'Feed forward'];
                                        const active = patch.feedForward === mode;
                                        return (
                                            <button
                                                key={labels[index]}
                                                type="button"
                                                className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                                onClick={() => setGlutenParamWithAudio('feedForward', mode)}
                                            >
                                                {labels[index]}
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        ) : null}
                    </ControlCard>

                    <ControlCard title="Stage two" detail="Blend a second topology in when the first one needs backup.">
                        <div className="flex flex-wrap gap-1.5">
                            {stageTwoOptions.map((topology) => {
                                const active = patch.blendTopology === topology;
                                return (
                                    <button
                                        key={topology}
                                        type="button"
                                        className={`gluten-chip ${active ? 'gluten-chip-active' : ''}`}
                                        onClick={() => setGlutenParamWithAudio('blendTopology', topology)}
                                    >
                                        {TOPOLOGY_META[topology].label}
                                    </button>
                                );
                            })}
                        </div>
                    </ControlCard>
                </aside>
            </div>
        </div>
    );
};
