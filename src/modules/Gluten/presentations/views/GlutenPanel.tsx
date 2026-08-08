import { type ReactElement, type ReactNode, useState } from 'react';

import { Activity, Flame, Radio, Search, SlidersHorizontal, Sun, Zap } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginChoiceRow } from '#/components/daw/DawPluginChoiceRow';
import { DawPluginInsetCard } from '#/components/daw/DawPluginInsetCard';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginMetricStrip } from '#/components/daw/DawPluginMetricStrip';
import { DawPluginMetricTile } from '#/components/daw/DawPluginMetricTile';
import { DawPluginRail } from '#/components/daw/DawPluginRail';
import { DawPluginReadoutList } from '#/components/daw/DawPluginReadoutList';
import { DawPluginSectionCard } from '#/components/daw/DawPluginSectionCard';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { Stack, Row, Grid } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';

import {
    OVERSAMPLING_FACTORS,
    type GlutenPatch,
    type GlutenStyle,
    type GlutenTopology,
} from '../../models/GlutenPatch';
import { glutenStore, getGlutenState, type GlutenState } from '../../stores/glutenStore';
import { loadGlutenPatchWithAudio } from '../../useCases/glutenParamBridge/loadGlutenPatchWithAudio';
import { setGlutenParamWithAudio } from '../../useCases/glutenParamBridge/setGlutenParamWithAudio';
import { GLUTEN_PRESETS } from '../../useCases/glutenPresets';
import { GlutenCurve } from '../components/GlutenCurve';
import { GrHistory } from '../components/GrHistory';
import { GrMeter } from '../components/GrMeter';
import { useGlutenMeters } from '../hooks/useGlutenMeters';

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
        color: 'var(--color-accent-lavender)',
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

const LensBar = ({
    label,
    value,
    accentColor,
}: {
    label: string;
    value: number;
    accentColor: string;
}): ReactElement => (
    <Stack gap={1}>
        <Row justify="between" gap={2} className="text-[9px] text-muted-foreground">
            <span>{label}</span>
            <span className="font-mono text-[8px] text-foreground/80">{Math.round(value * 100)}%</span>
        </Row>
        <div className="h-1.5 rounded-full bg-white/6">
            <div
                className="h-full rounded-full"
                style={{ width: `${Math.round(value * 100)}%`, backgroundColor: accentColor }}
            />
        </div>
    </Stack>
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
    <DawPluginSectionCard
        className="gluten-window"
        title={title}
        detail={detail}
        titleClassName="text-[var(--color-accent-lavender)]/68"
    >
        {children}
    </DawPluginSectionCard>
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
    <DawPluginChip
        active={active}
        tone="neutral"
        size="sm"
        style={active ? { borderColor: accentColor, color: accentColor } : undefined}
        onClick={onClick}
    >
        {label}
    </DawPluginChip>
);

const Knob = ({
    deviceId,
    value,
    param,
    label,
    min,
    max,
    step,
    defaultValue,
    unit,
}: {
    deviceId: string;
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
            onChange={(nextValue, isTransient) =>
                setGlutenParamWithAudio(deviceId, param, nextValue as GlutenPatch[typeof param], isTransient)
            }
            min={min}
            max={max}
            step={step}
            defaultValue={defaultValue}
            size="sm"
            tone="lavender"
        />
        <div className="text-center">
            <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">{label}</div>
            <div className="font-mono text-[9px] text-foreground/85">{formatValue(value, unit)}</div>
        </div>
    </div>
);

const defaultGlutenInstances: Record<string, GlutenState> = {};

export const GlutenPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const allInstances = useStore(glutenStore, defaultGlutenInstances);
    const state: GlutenState = allInstances[deviceId] ?? getGlutenState(deviceId);
    // Meters live in their own per-device store: a ~60 Hz tick on this device
    // re-renders this panel's meter readouts without rebuilding the patch map,
    // and a tick on another open panel leaves this one untouched.
    const { grDb, inputDb, outputDb, crest, phaseCorr, latency } = useGlutenMeters(deviceId);
    const [search, setSearch] = useState('');
    const [category, setCategory] = useState('all');

    const { patch } = state;
    const currentPatch = patch;

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

    let phaseCorrStr = phaseCorr.toFixed(2);
    if (phaseCorr > 0.99) {
        phaseCorrStr = 'Mono';
    } else if (phaseCorr < -0.99) {
        phaseCorrStr = 'OOP';
    }

    function applyPreset(nextPatch: GlutenPatch): void {
        loadGlutenPatchWithAudio(deviceId, nextPatch);
    }

    function applyStyle(style: GlutenStyle): void {
        applyPreset(buildStylePatch(style, currentPatch));
    }

    return (
        <div className="gluten-faceplate h-full min-h-0 overflow-hidden rounded-[26px] p-3">
            <div className="grid h-full min-h-0 grid-cols-[15rem_minmax(0,1fr)_19rem] gap-3">
                <DawPluginRail className="gluten-window p-3" scrollable={false}>
                    <Row align="start" justify="between" gap={3}>
                        <Stack gap={1}>
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-lavender)]/68">
                                Presets
                            </div>
                            <div className="text-[15px] font-semibold text-foreground">Gluten</div>
                        </Stack>
                        <DawPluginLed tone="lavender">{filteredPresets.length} ready</DawPluginLed>
                    </Row>

                    <Row as="label" gap={2} className="gluten-window px-3 py-2">
                        <Search className="size-3.5 text-muted-foreground/55" />
                        <input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Find a squeeze"
                            className="min-w-0 flex-1 bg-transparent text-[11px] text-foreground outline-none placeholder:text-muted-foreground/45"
                            aria-label="Search Gluten presets"
                        />
                    </Row>

                    <Row wrap gap={1.5}>
                        {CATEGORIES.map((entry) => {
                            const active = category === entry;
                            return (
                                <DawPluginChip
                                    key={entry}
                                    active={active}
                                    tone="lavender"
                                    size="sm"
                                    onClick={() => setCategory(entry)}
                                >
                                    {entry === 'all' ? 'All' : entry}
                                </DawPluginChip>
                            );
                        })}
                    </Row>

                    <Stack grow gap={2} className="min-h-0 overflow-y-auto pr-1">
                        {filteredPresets.length > 0 ? (
                            filteredPresets.map((preset) => {
                                const active = preset.patch.name === patch.name;
                                return (
                                    <DawPluginChoiceRow
                                        key={preset.id}
                                        className="gluten-window"
                                        active={active}
                                        title={preset.name}
                                        detail={preset.category}
                                        subtitle={describePreset(preset.patch)}
                                        onPress={() => applyPreset(preset.patch)}
                                    />
                                );
                            })
                        ) : (
                            <Stack
                                grow
                                align="center"
                                justify="center"
                                className="gluten-window px-4 py-6 text-center text-[11px] leading-5 text-muted-foreground"
                            >
                                No preset matches that search yet. Try another category or a looser word.
                            </Stack>
                        )}
                    </Stack>
                </DawPluginRail>

                <Stack gap={3} className="min-h-0 min-w-0 overflow-y-auto pr-1">
                    <Row align="start" justify="between" gap={3}>
                        <Stack gap={2}>
                            <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-lavender)]/68">
                                Dynamics cockpit
                            </div>
                            <div className="text-[16px] font-semibold text-foreground">{patch.name}</div>
                        </Stack>

                        <DawPluginMetricStrip>
                            <DawPluginMetricTile
                                className="gluten-window min-w-[90px]"
                                label="Grab"
                                value={`${Math.abs(grDb).toFixed(1)} dB`}
                                detail="Current gain reduction"
                            />
                            <DawPluginMetricTile
                                className="gluten-window min-w-[90px]"
                                label="Crest"
                                value={`${crest.toFixed(1)} dB`}
                                detail="Transient spread"
                            />
                            <DawPluginMetricTile
                                className="gluten-window min-w-[90px]"
                                label="Phase"
                                value={phaseCorrStr}
                                detail="Stereo correlation"
                            />
                            <DawPluginMetricTile
                                className="gluten-window min-w-[90px]"
                                label="Latency"
                                value={`${latency} smp`}
                                detail="Lookahead cost"
                            />
                        </DawPluginMetricStrip>
                    </Row>

                    <Grid cols={4} gap={2}>
                        {TOPOLOGIES.map((topology) => {
                            const meta = TOPOLOGY_META[topology];
                            const Icon = meta.icon;
                            const active = patch.topology === topology;
                            return (
                                <Stack
                                    key={topology}
                                    as="button"
                                    align="start"
                                    gap={2}
                                    className={`gluten-window px-3 py-2 text-left transition-all ${
                                        active
                                            ? 'border-white/18 bg-white/[0.035]'
                                            : 'hover:border-white/12 hover:bg-white/[0.02]'
                                    }`}
                                    style={active ? { borderColor: meta.color } : undefined}
                                    onClick={() => setGlutenParamWithAudio(deviceId, 'topology', topology)}
                                >
                                    <Row justify="between" gap={3} className="w-full">
                                        <Row gap={2}>
                                            <div
                                                className="rounded-full border border-white/10 p-1.5"
                                                style={{ color: meta.color }}
                                            >
                                                <Icon className="size-3.5" />
                                            </div>
                                            <Stack>
                                                <div className="text-[10px] font-semibold text-foreground">
                                                    {meta.label}
                                                </div>
                                                <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/42">
                                                    {meta.detail}
                                                </div>
                                            </Stack>
                                        </Row>
                                        {active ? <DawPluginLed tone="lavender">Live</DawPluginLed> : null}
                                    </Row>
                                </Stack>
                            );
                        })}
                    </Grid>

                    <Stack gap={3} className="gluten-window min-h-0 shrink-0 p-3">
                        <Row align="start" justify="between" gap={3}>
                            <Stack gap={1}>
                                <div className="text-[8px] uppercase tracking-[0.26em] text-[var(--color-accent-lavender)]/68">
                                    Quick moves
                                </div>
                                <div className="text-[13px] font-semibold text-foreground">
                                    {STYLE_META[patch.style].label}
                                </div>
                            </Stack>

                            <Row wrap justify="end" gap={1.5}>
                                {STYLES.map((style) => {
                                    const active = patch.style === style;
                                    return (
                                        <DawPluginChip
                                            key={style}
                                            active={active}
                                            tone="lavender"
                                            size="sm"
                                            onClick={() => applyStyle(style)}
                                        >
                                            {STYLE_META[style].label}
                                        </DawPluginChip>
                                    );
                                })}
                            </Row>
                        </Row>

                        <Grid gap={3} className="min-h-0 flex-1 grid-cols-[minmax(0,1fr)_3.75rem]">
                            <Stack gap={3} className="min-h-0">
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
                                        onThresholdChange={(value, isTransient) =>
                                            setGlutenParamWithAudio(deviceId, 'threshold', value, isTransient)
                                        }
                                        accentColor={accentColor}
                                    />
                                </div>
                                <div className="overflow-x-auto">
                                    <GrHistory grDb={grDb} width={420} height={50} accentColor={accentColor} />
                                </div>
                                <Grid cols={3} gap={2}>
                                    <DawPluginInsetCard
                                        className="gluten-window"
                                        title="Detector lens"
                                        titleClassName="text-foreground"
                                        actions={<Activity className="size-3.5" style={{ color: accentColor }} />}
                                    >
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
                                    </DawPluginInsetCard>
                                    <DawPluginInsetCard
                                        className="gluten-window"
                                        title="Sidechain"
                                        titleClassName="text-foreground"
                                        actions={
                                            <SlidersHorizontal className="size-3.5" style={{ color: accentColor }} />
                                        }
                                    >
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
                                    </DawPluginInsetCard>
                                    <DawPluginInsetCard
                                        className="gluten-window"
                                        title="Quick read"
                                        titleClassName="text-foreground"
                                        actions={<DawPluginLed tone="lavender">{topologyMeta.detail}</DawPluginLed>}
                                    >
                                        <DawPluginReadoutList density="tight">
                                            <DawReadoutRow
                                                label="Input"
                                                value={`${inputDb.toFixed(1)} dB`}
                                                valueClassName="text-foreground/85"
                                            />
                                            <DawReadoutRow
                                                label="Output"
                                                value={`${outputDb.toFixed(1)} dB`}
                                                valueClassName="text-foreground/85"
                                            />
                                            <DawReadoutRow
                                                label="Mode"
                                                value={patch.detection.toUpperCase()}
                                                valueClassName="text-foreground/85"
                                            />
                                            <DawReadoutRow
                                                label="Story"
                                                value={STYLE_META[patch.style].detail}
                                                valueClassName="text-foreground/85"
                                            />
                                        </DawPluginReadoutList>
                                    </DawPluginInsetCard>
                                </Grid>
                            </Stack>

                            <GrMeter
                                grDb={grDb}
                                width={54}
                                height={236}
                                accentColor={accentColor}
                                label={`${patch.name} gain reduction meter`}
                            />
                        </Grid>
                    </Stack>
                </Stack>

                <DawPluginRail>
                    <ControlCard title="Clamp" detail="Threshold, ratio, and timing stay front and center.">
                        <Grid cols={3} gapX={2} gapY={3}>
                            <Knob
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
                                value={patch.amount}
                                param="amount"
                                label="Amount"
                                min={0}
                                max={100}
                                step={1}
                                defaultValue={50}
                            />
                        </Grid>
                    </ControlCard>

                    <ControlCard title="Finish" detail="Keep the lane honest while you blend and level.">
                        <Grid cols={3} gapX={2} gapY={3}>
                            <Knob
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
                                value={patch.blendAmount}
                                param="blendAmount"
                                label="Stage 2"
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0}
                                unit="mix"
                            />
                        </Grid>
                        <Row wrap gap={1.5}>
                            <ToggleChip
                                label="Auto rel"
                                active={patch.autoRelease}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio(deviceId, 'autoRelease', !patch.autoRelease)}
                            />
                            <ToggleChip
                                label="Auto gain"
                                active={patch.autoMakeup}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio(deviceId, 'autoMakeup', !patch.autoMakeup)}
                            />
                            <ToggleChip
                                label="Delta"
                                active={patch.deltaListen}
                                accentColor={accentColor}
                                onClick={() => setGlutenParamWithAudio(deviceId, 'deltaListen', !patch.deltaListen)}
                            />
                            <ToggleChip
                                label="Match"
                                active={patch.gainMatchBypass}
                                accentColor={accentColor}
                                onClick={() =>
                                    setGlutenParamWithAudio(deviceId, 'gainMatchBypass', !patch.gainMatchBypass)
                                }
                            />
                        </Row>
                    </ControlCard>

                    <ControlCard
                        title="Detector"
                        detail="Sidechain filters and listen modes live together instead of hiding in the header."
                    >
                        <Grid cols={3} gapX={2} gapY={3}>
                            <Knob
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
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
                                deviceId={deviceId}
                                value={patch.scEqQ}
                                param="scEqQ"
                                label="EQ Q"
                                min={0.1}
                                max={10}
                                step={0.1}
                                defaultValue={1}
                            />
                            <Stack gap={1} className="items-center">
                                <Row gap={1}>
                                    {OVERSAMPLING_FACTORS.map((factor) => {
                                        const active = patch.oversampling === factor;
                                        return (
                                            <DawPluginChip
                                                key={factor}
                                                active={active}
                                                tone="lavender"
                                                size="sm"
                                                onClick={() =>
                                                    setGlutenParamWithAudio(deviceId, 'oversampling', factor)
                                                }
                                            >
                                                {`${factor}×`}
                                            </DawPluginChip>
                                        );
                                    })}
                                </Row>
                                <div className="text-[8px] uppercase tracking-[0.2em] text-muted-foreground/60">OS</div>
                            </Stack>
                        </Grid>
                        <Stack gap={2}>
                            <Row wrap gap={1.5}>
                                <ToggleChip
                                    label="HPF"
                                    active={patch.scHpfEnabled}
                                    accentColor={accentColor}
                                    onClick={() =>
                                        setGlutenParamWithAudio(deviceId, 'scHpfEnabled', !patch.scHpfEnabled)
                                    }
                                />
                                <ToggleChip
                                    label="LPF"
                                    active={patch.scLpfEnabled}
                                    accentColor={accentColor}
                                    onClick={() =>
                                        setGlutenParamWithAudio(deviceId, 'scLpfEnabled', !patch.scLpfEnabled)
                                    }
                                />
                                <ToggleChip
                                    label="SC EQ"
                                    active={patch.scEqEnabled}
                                    accentColor={accentColor}
                                    onClick={() => setGlutenParamWithAudio(deviceId, 'scEqEnabled', !patch.scEqEnabled)}
                                />
                                <ToggleChip
                                    label="Ext SC"
                                    active={patch.extSidechain}
                                    accentColor={accentColor}
                                    onClick={() =>
                                        setGlutenParamWithAudio(deviceId, 'extSidechain', !patch.extSidechain)
                                    }
                                />
                            </Row>
                            <Row wrap gap={1.5}>
                                {(['rms', 'peak'] as const).map((mode) => {
                                    const active = patch.detection === mode;
                                    return (
                                        <DawPluginChip
                                            key={mode}
                                            active={active}
                                            tone="lavender"
                                            size="sm"
                                            onClick={() => setGlutenParamWithAudio(deviceId, 'detection', mode)}
                                        >
                                            {mode.toUpperCase()}
                                        </DawPluginChip>
                                    );
                                })}
                                {(['stereo', 'mid', 'side', 'dual-mono'] as const).map((mode) => {
                                    const active = patch.stereoMode === mode;
                                    return (
                                        <DawPluginChip
                                            key={mode}
                                            active={active}
                                            tone="lavender"
                                            size="sm"
                                            onClick={() => setGlutenParamWithAudio(deviceId, 'stereoMode', mode)}
                                        >
                                            {mode === 'dual-mono' ? 'Dual mono' : mode}
                                        </DawPluginChip>
                                    );
                                })}
                            </Row>
                            <Row wrap gap={1.5}>
                                {[0, 1, 2].map((thrust) => {
                                    const labels = ['Thrust off', 'Thrust med', 'Thrust loud'];
                                    const active = patch.thrust === thrust;
                                    return (
                                        <DawPluginChip
                                            key={thrust}
                                            active={active}
                                            tone="lavender"
                                            size="sm"
                                            onClick={() => setGlutenParamWithAudio(deviceId, 'thrust', thrust)}
                                        >
                                            {labels[thrust]}
                                        </DawPluginChip>
                                    );
                                })}
                            </Row>
                        </Stack>
                    </ControlCard>

                    <ControlCard title="Character" detail="The last mile changes with the topology you picked.">
                        {patch.topology === 'fet' ? (
                            <Stack gap={3}>
                                <Grid cols={3} gapX={2} gapY={3}>
                                    <Knob
                                        deviceId={deviceId}
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
                                        deviceId={deviceId}
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
                                        deviceId={deviceId}
                                        value={patch.xfmrDrive}
                                        param="xfmrDrive"
                                        label="Xfmr"
                                        min={0}
                                        max={3}
                                        step={0.01}
                                        defaultValue={1.2}
                                    />
                                    <Knob
                                        deviceId={deviceId}
                                        value={patch.jfetK3}
                                        param="jfetK3"
                                        label="Odd"
                                        min={0}
                                        max={0.5}
                                        step={0.01}
                                        defaultValue={0.15}
                                    />
                                    <Knob
                                        deviceId={deviceId}
                                        value={patch.xfmrK2}
                                        param="xfmrK2"
                                        label="Even"
                                        min={0}
                                        max={0.3}
                                        step={0.01}
                                        defaultValue={0}
                                    />
                                </Grid>
                                <ToggleChip
                                    label="All buttons"
                                    active={patch.allButtons}
                                    accentColor={accentColor}
                                    onClick={() => setGlutenParamWithAudio(deviceId, 'allButtons', !patch.allButtons)}
                                />
                            </Stack>
                        ) : null}

                        {patch.topology === 'opto' ? (
                            <Stack gap={2}>
                                <Row wrap gap={1.5}>
                                    {[false, true].map((mode, index) => {
                                        const labels = ['Compress', 'Limit'];
                                        const active = patch.limitMode === mode;
                                        return (
                                            <ToggleChip
                                                key={labels[index]}
                                                label={labels[index] ?? ''}
                                                active={active}
                                                accentColor={accentColor}
                                                onClick={() => setGlutenParamWithAudio(deviceId, 'limitMode', mode)}
                                            />
                                        );
                                    })}
                                </Row>
                                <p className="text-[10px] leading-4 text-muted-foreground">
                                    Limit leans harder on the cell. Compress lets it breathe.
                                </p>
                            </Stack>
                        ) : null}

                        {patch.topology === 'diode' ? (
                            <Stack gap={2}>
                                <Row wrap gap={1.5}>
                                    {[1, 2, 3, 4, 5].map((value) => {
                                        const active = patch.recovery === value;
                                        return (
                                            <ToggleChip
                                                key={value}
                                                label={`Recovery ${value}`}
                                                active={active}
                                                accentColor={accentColor}
                                                onClick={() => setGlutenParamWithAudio(deviceId, 'recovery', value)}
                                            />
                                        );
                                    })}
                                </Row>
                                <p className="text-[10px] leading-4 text-muted-foreground">
                                    Lower values grab harder. Higher values relax into the tail.
                                </p>
                            </Stack>
                        ) : null}

                        {patch.topology === 'vca' ? (
                            <Stack gap={3}>
                                <Grid cols={2} gap={2}>
                                    <Knob
                                        deviceId={deviceId}
                                        value={patch.vcaCharacter}
                                        param="vcaCharacter"
                                        label="Color"
                                        min={0}
                                        max={0.02}
                                        step={0.001}
                                        defaultValue={0.003}
                                    />
                                    <Knob
                                        deviceId={deviceId}
                                        value={patch.vcaType}
                                        param="vcaType"
                                        label="VCA type"
                                        min={0}
                                        max={2}
                                        step={1}
                                        defaultValue={1}
                                    />
                                </Grid>
                                <Row wrap gap={1.5}>
                                    {[false, true].map((mode, index) => {
                                        const labels = ['Feedback', 'Feed forward'];
                                        const active = patch.feedForward === mode;
                                        return (
                                            <ToggleChip
                                                key={labels[index]}
                                                label={labels[index] ?? ''}
                                                active={active}
                                                accentColor={accentColor}
                                                onClick={() => setGlutenParamWithAudio(deviceId, 'feedForward', mode)}
                                            />
                                        );
                                    })}
                                </Row>
                            </Stack>
                        ) : null}
                    </ControlCard>

                    <ControlCard title="Stage two" detail="Blend a second topology in when the first one needs backup.">
                        <Row wrap gap={1.5}>
                            {stageTwoOptions.map((topology) => {
                                const active = patch.blendTopology === topology;
                                return (
                                    <ToggleChip
                                        key={topology}
                                        label={TOPOLOGY_META[topology].label}
                                        active={active}
                                        accentColor={accentColor}
                                        onClick={() => setGlutenParamWithAudio(deviceId, 'blendTopology', topology)}
                                    />
                                );
                            })}
                        </Row>
                    </ControlCard>
                </DawPluginRail>
            </div>
        </div>
    );
};
