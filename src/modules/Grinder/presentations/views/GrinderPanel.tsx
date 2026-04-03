/**
 * Grinder — amp simulator, cabinet loader, pedalboard host panel.
 *
 * 5-level progressive disclosure:
 *   Level 1 (Play): Amp head view — Gain, Bass, Mid, Treble, Master, Cab, Presets
 *   Level 2 (Shape): Model switches, Bright/Fat/Channel, essential pedal tray
 *   Level 3 (Build): Drag-drop pedal chain, cab/mic room, IR browser
 *   Level 4 (Route): Split/merge, stereo, dual-amp, per-stage meters
 *   Level 5 (Lab): Tube bias, sag, transformer, neural loader, diagnostics
 */
import { type ReactElement, useSyncExternalStore } from 'react';
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { grinderStore, type GrinderState, type GrinderUiLevel, setGrinderUiLevel } from '../../stores/grinderStore';
import { loadGrinderPatchWithAudio, setGrinderParamWithAudio } from '../../useCases/grinderParamBridge';
import { GRINDER_PRESETS } from '../../useCases/grinderPresets';
import {
    type GrinderAmpModel,
    type GrinderPatch,
    type GrinderPedal,
    type GrinderPedalType,
    type GrinderToneStackType,
    type GrinderPowerTubeType,
    type GrinderRectifierType,
} from '../../models/GrinderPatch';

const LEVELS: { id: GrinderUiLevel; label: string; description: string }[] = [
    { id: 1, label: 'Play', description: 'Amp head view' },
    { id: 2, label: 'Shape', description: 'Switches & pedal tray' },
    { id: 3, label: 'Build', description: 'Rig builder & mic room' },
    { id: 4, label: 'Route', description: 'Signal topology' },
    { id: 5, label: 'Lab', description: 'Component engineering' },
];

const AMP_MODELS: { id: GrinderAmpModel; label: string; description: string }[] = [
    { id: 'clean-twin', label: 'Clean Twin', description: 'Fender Twin · 6L6 · Blackface clean' },
    { id: 'crunch-jcm', label: 'British Crunch', description: 'Marshall JCM · EL34 · Rock crunch' },
    { id: 'lead-jcm', label: 'British Lead', description: 'Marshall Lead · EL34 · High gain' },
    { id: 'ac30-tb', label: 'AC30 Top Boost', description: 'Vox AC30 · EL84 · Chimey' },
    { id: 'rectifier', label: 'Rectifier', description: 'Mesa-style · 6L6 · Modern high gain' },
    { id: 'custom', label: 'Custom', description: 'User-defined topology' },
];

const TONE_STACK_TYPES: GrinderToneStackType[] = ['fender', 'marshall', 'vox'];
const POWER_TUBE_TYPES: GrinderPowerTubeType[] = ['6l6', 'el34', 'el84'];
const RECTIFIER_TYPES: GrinderRectifierType[] = ['tube', 'solid-state', 'variac'];

type SupportedPedalControl = {
    label: string;
    type: GrinderPedalType;
    defaults: GrinderPedal;
    params: Array<{
        key: string;
        label: string;
        min: number;
        max: number;
        step: number;
        defaultValue: number;
        unit?: string;
    }>;
};

const SUPPORTED_PRE_PEDALS: readonly SupportedPedalControl[] = [
    {
        label: 'Compressor',
        type: 'compressor',
        defaults: {
            id: 'comp1',
            type: 'compressor',
            enabled: false,
            params: { threshold: -20, ratio: 4, attack: 10, release: 200 },
        },
        params: [
            { key: 'threshold', label: 'Threshold', min: -40, max: 0, step: 1, defaultValue: -20, unit: 'dB' },
            { key: 'ratio', label: 'Ratio', min: 1, max: 8, step: 0.5, defaultValue: 4 },
            { key: 'attack', label: 'Attack', min: 1, max: 50, step: 1, defaultValue: 10, unit: 'ms' },
            { key: 'release', label: 'Release', min: 50, max: 400, step: 5, defaultValue: 200, unit: 'ms' },
        ],
    },
    {
        label: 'Overdrive',
        type: 'overdrive',
        defaults: {
            id: 'od1',
            type: 'overdrive',
            enabled: false,
            params: { drive: 4, tone: 6, level: 7 },
        },
        params: [
            { key: 'drive', label: 'Drive', min: 0, max: 10, step: 0.1, defaultValue: 4 },
            { key: 'tone', label: 'Tone', min: 0, max: 10, step: 0.1, defaultValue: 6 },
            { key: 'level', label: 'Level', min: 0, max: 10, step: 0.1, defaultValue: 7 },
        ],
    },
    {
        label: 'Distortion',
        type: 'distortion',
        defaults: {
            id: 'dist1',
            type: 'distortion',
            enabled: false,
            params: { drive: 5, tone: 5, level: 6 },
        },
        params: [
            { key: 'drive', label: 'Drive', min: 0, max: 10, step: 0.1, defaultValue: 5 },
            { key: 'tone', label: 'Tone', min: 0, max: 10, step: 0.1, defaultValue: 5 },
            { key: 'level', label: 'Level', min: 0, max: 10, step: 0.1, defaultValue: 6 },
        ],
    },
    {
        label: 'Fuzz',
        type: 'fuzz',
        defaults: {
            id: 'fuzz1',
            type: 'fuzz',
            enabled: false,
            params: { fuzz: 7, tone: 5, level: 6 },
        },
        params: [
            { key: 'fuzz', label: 'Fuzz', min: 0, max: 10, step: 0.1, defaultValue: 7 },
            { key: 'tone', label: 'Tone', min: 0, max: 10, step: 0.1, defaultValue: 5 },
            { key: 'level', label: 'Level', min: 0, max: 10, step: 0.1, defaultValue: 6 },
        ],
    },
];

function formatValue(v: number, unit: string): string {
    if (unit === 'dB') {
        return `${v > 0 ? '+' : ''}${v.toFixed(1)}`;
    }
    if (unit === 'ms') {
        return v >= 1000 ? `${(v / 1000).toFixed(1)}s` : `${v.toFixed(0)}ms`;
    }
    if (unit === 'Hz') {
        return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v.toFixed(0)}`;
    }
    if (unit === 'kΩ') {
        return v >= 1000 ? `${(v / 1000).toFixed(0)}MΩ` : `${v.toFixed(0)}kΩ`;
    }
    return `${v.toFixed(1)}`;
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
}: {
    v: number;
    k: string;
    label: string;
    min: number;
    max: number;
    step: number;
    def: number;
    unit?: string;
}): ReactElement => (
    <div className="flex flex-col items-center gap-0">
        <RotaryKnob
            value={v}
            onChange={(val) => setGrinderParamWithAudio(k as never, val)}
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

function upsertPedal(
    pedals: readonly GrinderPedal[],
    type: GrinderPedalType,
    defaults: GrinderPedal,
    update: (pedal: GrinderPedal) => GrinderPedal
): GrinderPedal[] {
    const existing = pedals.find((pedal) => pedal.type === type);
    if (!existing) {
        return [...pedals, update(defaults)];
    }
    return pedals.map((pedal) => (pedal.type === type ? update(pedal) : pedal));
}

function updatePedalCollection(
    patch: GrinderPatch,
    section: 'prePedals',
    type: GrinderPedalType,
    defaults: GrinderPedal,
    update: (pedal: GrinderPedal) => GrinderPedal
): void {
    const nextPedals = upsertPedal(patch[section], type, defaults, update);
    const nextPatch: GrinderPatch = {
        ...patch,
        [section]: nextPedals,
    };
    loadGrinderPatchWithAudio(nextPatch);
}

function renderPedalControls(
    patch: GrinderPatch,
    section: 'prePedals',
    controls: readonly SupportedPedalControl[]
): ReactElement {
    return (
        <div className="flex gap-2 flex-wrap">
            {controls.map((control) => {
                const pedal = patch[section].find((entry) => entry.type === control.type) ?? control.defaults;
                return (
                    <div
                        key={`${section}-${control.type}`}
                        className="space-y-2 rounded border border-border/20 bg-surface-inset/30 p-2"
                    >
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={pedal.enabled}
                                onChange={(e) =>
                                    updatePedalCollection(patch, section, control.type, control.defaults, (current) => ({
                                        ...current,
                                        enabled: e.target.checked,
                                    }))
                                }
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(217,119,6)' }}
                            />
                            <span className="font-medium text-foreground/80">{control.label}</span>
                        </label>
                        <div className="flex gap-2 flex-wrap">
                            {control.params.map((param) => {
                                return (
                                    <div
                                        key={`${control.type}-${param.key}`}
                                        onClick={(event) => event.stopPropagation()}
                                    >
                                        <RotaryKnob
                                            value={pedal.params[param.key] ?? param.defaultValue}
                                            onChange={(val) =>
                                                updatePedalCollection(
                                                    patch,
                                                    section,
                                                    control.type,
                                                    control.defaults,
                                                    (current) => ({
                                                        ...current,
                                                        params: {
                                                            ...current.params,
                                                            [param.key]: val,
                                                        },
                                                    })
                                                )
                                            }
                                            min={param.min}
                                            max={param.max}
                                            step={param.step}
                                            defaultValue={param.defaultValue}
                                            size="sm"
                                        />
                                        <div className="mt-0.5 text-center text-[7px] text-muted-foreground leading-none">
                                            {param.label}
                                        </div>
                                        {param.unit ? (
                                            <div className="text-center text-[6px] font-mono text-muted-foreground/40">
                                                {formatValue(pedal.params[param.key] ?? param.defaultValue, param.unit)}
                                            </div>
                                        ) : null}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

// ── Level 1: Play ────────────────────────────────────────────────────────────

const PlayLevel = ({ state }: { state: GrinderState }): ReactElement => {
    const patch = state.patch;
    const [presetMenuOpen, setPresetMenuOpen] = useState(false);

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Amp head visual */}
            <div
                className="flex-1 flex flex-col items-center justify-center gap-4 p-4"
                style={{
                    background: 'radial-gradient(ellipse at center top, rgba(217,119,6,0.06) 0%, rgba(0,0,0,0.95) 70%)',
                }}
            >
                {/* Amp model name */}
                <div className="text-center">
                    <div className="text-[11px] font-bold text-amber-400 uppercase tracking-widest">
                        {AMP_MODELS.find((m) => m.id === patch.ampModel)?.label ?? 'Custom'}
                    </div>
                    <div className="text-[8px] text-muted-foreground/40">
                        {AMP_MODELS.find((m) => m.id === patch.ampModel)?.description}
                    </div>
                </div>

                {/* Main amp controls */}
                <div className="flex gap-5">
                    <K v={patch.gain} k="gain" label="Gain" min={0} max={10} step={0.1} def={5} />
                    <K v={patch.bass} k="bass" label="Bass" min={0} max={10} step={0.1} def={5} />
                    <K v={patch.mid} k="mid" label="Mid" min={0} max={10} step={0.1} def={5} />
                    <K v={patch.treble} k="treble" label="Treble" min={0} max={10} step={0.1} def={5} />
                    <K v={patch.master} k="master" label="Master" min={0} max={10} step={0.1} def={5} />
                </div>

                {/* Presence / Resonance */}
                <div className="flex gap-4">
                    <K v={patch.presence} k="presence" label="Presence" min={0} max={10} step={0.1} def={5} />
                    <K v={patch.resonance} k="resonance" label="Resonance" min={0} max={10} step={0.1} def={5} />
                </div>
            </div>

            {/* Right: Preset browser + cab + output */}
            <div className="w-[180px] shrink-0 p-2 space-y-3 border-l border-border/20">
                {/* Preset selector */}
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
                            {GRINDER_PRESETS.map((preset) => (
                                <button
                                    key={preset.id}
                                    type="button"
                                    className={`w-full text-left px-2 py-1 text-[9px] hover:bg-surface-inset transition-colors ${
                                        preset.patch.name === patch.name
                                            ? 'text-foreground font-medium'
                                            : 'text-foreground/70'
                                    }`}
                                    onClick={() => {
                                        loadGrinderPatchWithAudio(preset.patch);
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

                {/* Cabinet */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Cabinet
                    </div>
                    <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={patch.cabEnabled}
                            onChange={(e) => setGrinderParamWithAudio('cabEnabled' as never, e.target.checked ? 1 : 0)}
                            className="size-2.5 rounded"
                            style={{ accentColor: 'rgb(217,119,6)' }}
                        />
                        Cab On
                    </label>
                </div>

                {/* Output */}
                <div className="space-y-1">
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

                {/* Metering */}
                <div className="space-y-0.5 text-[7px] text-muted-foreground/40 font-mono">
                    <div>In: {formatValue(state.inputDb, 'dB')}</div>
                    <div>Pre: {formatValue(state.preampDb, 'dB')}</div>
                    <div>PA: {formatValue(state.powerAmpDb, 'dB')}</div>
                    <div>Out: {formatValue(state.outputDb, 'dB')}</div>
                    {state.sagVoltage < 0.98 ? (
                        <div className="text-amber-500/60">Sag: {(state.sagVoltage * 100).toFixed(0)}%</div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

// ── Level 2: Shape ───────────────────────────────────────────────────────────

const ShapeLevel = ({ state }: { state: GrinderState }): ReactElement => {
    const patch = state.patch;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden p-3 gap-3">
            {/* Left: Amp model + switches */}
            <div className="space-y-3 w-[200px] shrink-0">
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Amp Model
                    </div>
                    <div className="flex flex-col gap-0.5">
                        {AMP_MODELS.map((model) => (
                            <button
                                key={model.id}
                                type="button"
                                className={`px-2 py-1 rounded text-[8px] font-medium text-left transition-colors ${
                                    patch.ampModel === model.id
                                        ? 'bg-amber-600/20 text-amber-400'
                                        : 'text-muted-foreground/60 hover:text-foreground hover:bg-surface-raised'
                                }`}
                                onClick={() => setGrinderParamWithAudio('ampModel' as never, AMP_MODELS.indexOf(model))}
                            >
                                {model.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Switches */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Switches
                    </div>
                    <div className="flex gap-2">
                        {/* Channel */}
                        <div className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-0.5">
                                {['Clean', 'Crunch', 'Lead'].map((ch, i) => (
                                    <button
                                        key={ch}
                                        type="button"
                                        className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${
                                            patch.channel === i
                                                ? 'bg-amber-600 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setGrinderParamWithAudio('channel' as never, i)}
                                    >
                                        {ch}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[6px] text-muted-foreground leading-none">Channel</span>
                        </div>
                    </div>

                    <div className="flex gap-3">
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={patch.bright}
                                onChange={(e) => setGrinderParamWithAudio('bright' as never, e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(217,119,6)' }}
                            />
                            Bright
                        </label>
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                            <input
                                type="checkbox"
                                checked={patch.fat}
                                onChange={(e) => setGrinderParamWithAudio('fat' as never, e.target.checked ? 1 : 0)}
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(217,119,6)' }}
                            />
                            Fat
                        </label>
                    </div>
                </div>

                {/* Tone stack type */}
                <div className="space-y-0.5">
                    <span className="text-[7px] text-muted-foreground/40">Tone Stack:</span>
                    <div className="flex gap-0.5">
                        {TONE_STACK_TYPES.map((ts, i) => (
                            <button
                                key={ts}
                                type="button"
                                className={`px-1.5 py-0.5 rounded text-[7px] font-medium capitalize transition-colors ${
                                    patch.toneStackType === ts
                                        ? 'bg-amber-600 text-white'
                                        : 'text-muted-foreground/40 hover:text-foreground'
                                }`}
                                onClick={() => setGrinderParamWithAudio('toneStackType' as never, i)}
                            >
                                {ts}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Right: Quick pedal tray + main controls */}
            <div className="flex-1 overflow-y-auto space-y-3">
                {/* Main controls */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Amp Controls
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K v={patch.gain} k="gain" label="Gain" min={0} max={10} step={0.1} def={5} />
                        <K v={patch.bass} k="bass" label="Bass" min={0} max={10} step={0.1} def={5} />
                        <K v={patch.mid} k="mid" label="Mid" min={0} max={10} step={0.1} def={5} />
                        <K v={patch.treble} k="treble" label="Treble" min={0} max={10} step={0.1} def={5} />
                        <K v={patch.master} k="master" label="Master" min={0} max={10} step={0.1} def={5} />
                        <K v={patch.presence} k="presence" label="Presence" min={0} max={10} step={0.1} def={5} />
                        <K v={patch.resonance} k="resonance" label="Resonance" min={0} max={10} step={0.1} def={5} />
                    </div>
                </div>

                {/* Quick pedal tray */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Essential Pedals
                    </div>
                    <div className="flex gap-2">
                        {/* Gate */}
                        <div className="p-2 rounded border border-border/20 bg-surface-inset/50">
                            <label className="flex items-center gap-1 text-[7px] text-muted-foreground cursor-pointer mb-1">
                                <input
                                    type="checkbox"
                                    checked={patch.gateEnabled}
                                    onChange={(e) =>
                                        setGrinderParamWithAudio('gateEnabled' as never, e.target.checked ? 1 : 0)
                                    }
                                    className="size-2 rounded"
                                    style={{ accentColor: 'rgb(217,119,6)' }}
                                />
                                Gate
                            </label>
                            <K
                                v={patch.gateThreshold}
                                k="gateThreshold"
                                label="Thresh"
                                min={-80}
                                max={0}
                                step={1}
                                def={-60}
                                unit="dB"
                            />
                        </div>

                        {/* Input */}
                        <div className="p-2 rounded border border-border/20 bg-surface-inset/50">
                            <span className="text-[7px] text-muted-foreground block mb-1">Input</span>
                            <K
                                v={patch.inputGain}
                                k="inputGain"
                                label="Gain"
                                min={-24}
                                max={24}
                                step={0.5}
                                def={0}
                                unit="dB"
                            />
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Level 3: Build ───────────────────────────────────────────────────────────

const BuildLevel = ({ state }: { state: GrinderState }): ReactElement => {
    const patch = state.patch;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden">
            {/* Signal chain */}
            <div className="flex-1 p-3 overflow-y-auto space-y-2">
                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                    Signal Chain
                </div>

                {/* Chain blocks */}
                <div className="flex gap-1 items-center flex-wrap">
                    {/* Input */}
                    <div className="px-2 py-1 rounded border border-amber-600/30 bg-amber-600/10 text-[8px] text-amber-400 font-medium">
                        Input
                    </div>
                    <span className="text-muted-foreground/30 text-[10px]">→</span>

                    {/* Gate */}
                    <div
                        className={`px-2 py-1 rounded border text-[8px] font-medium ${
                            patch.gateEnabled
                                ? 'border-green-500/30 bg-green-500/10 text-green-400'
                                : 'border-border/20 text-muted-foreground/30'
                        }`}
                    >
                        Gate
                    </div>
                    <span className="text-muted-foreground/30 text-[10px]">→</span>

                    {/* Pre-pedals */}
                    {patch.prePedals.map((pedal) => (
                        <div key={pedal.id} className="flex items-center gap-1">
                            <div
                                className={`px-2 py-1 rounded border text-[7px] font-medium capitalize ${
                                    pedal.enabled
                                        ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                                        : 'border-border/20 text-muted-foreground/30'
                                }`}
                            >
                                {pedal.type}
                            </div>
                            <span className="text-muted-foreground/30 text-[10px]">→</span>
                        </div>
                    ))}

                    {/* Preamp */}
                    <div className="px-3 py-1.5 rounded border border-amber-600/40 bg-amber-600/15 text-[9px] text-amber-400 font-bold">
                        {AMP_MODELS.find((m) => m.id === patch.ampModel)?.label ?? 'Amp'}
                    </div>
                    <span className="text-muted-foreground/30 text-[10px]">→</span>

                    {/* Cabinet */}
                    <div
                        className={`px-2 py-1 rounded border text-[8px] font-medium ${
                            patch.cabEnabled
                                ? 'border-amber-600/30 bg-amber-600/10 text-amber-400'
                                : 'border-border/20 text-muted-foreground/30'
                        }`}
                    >
                        Cabinet
                    </div>
                    <span className="text-muted-foreground/30 text-[10px]">→</span>

                    {/* Output */}
                    <div className="px-2 py-1 rounded border border-amber-600/30 bg-amber-600/10 text-[8px] text-amber-400 font-medium">
                        Output
                    </div>
                </div>

                {/* Mic Room */}
                <div className="mt-3 space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Pre-Pedals
                    </div>
                    {renderPedalControls(patch, 'prePedals', SUPPORTED_PRE_PEDALS)}
                </div>

                {/* Mic Room */}
                <div className="mt-3 space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Mic Room
                    </div>
                    <div className="flex gap-4">
                        {/* Mic 1 */}
                        <div className="space-y-1 p-2 rounded border border-border/20 bg-surface-inset/30">
                            <div className="text-[7px] text-amber-400 font-medium">Mic 1 ({patch.mic1.type})</div>
                            <div className="flex gap-2">
                                <K
                                    v={patch.mic1.positionX}
                                    k="mic1PositionX"
                                    label="Center/Edge"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    def={0.3}
                                />
                                <K
                                    v={patch.mic1.distance}
                                    k="mic1Distance"
                                    label="Distance"
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    def={0.2}
                                />
                            </div>
                        </div>

                        {/* Mic 2 */}
                        <div className="space-y-1 p-2 rounded border border-border/20 bg-surface-inset/30">
                            <div className="flex items-center gap-1">
                                <input
                                    type="checkbox"
                                    checked={patch.mic2.enabled}
                                    onChange={() => {}}
                                    className="size-2 rounded"
                                    style={{ accentColor: 'rgb(217,119,6)' }}
                                />
                                <span className="text-[7px] text-muted-foreground">Mic 2 ({patch.mic2.type})</span>
                            </div>
                            <K v={patch.micBlend} k="micBlend" label="Blend" min={0} max={1} step={0.01} def={0} />
                        </div>

                        {/* Room */}
                        <K v={patch.roomAmount} k="roomAmount" label="Room" min={0} max={1} step={0.01} def={0.1} />
                    </div>
                </div>

                {/* Cabinet parameters */}
                <div className="mt-2 space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Speaker
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K
                            v={patch.cabResonanceFreq}
                            k="cabResonanceFreq"
                            label="Resonance"
                            min={40}
                            max={200}
                            step={1}
                            def={80}
                            unit="Hz"
                        />
                        <K v={patch.cabDamping} k="cabDamping" label="Damping" min={0} max={1} step={0.01} def={0.5} />
                        <K
                            v={patch.coneBreakup}
                            k="coneBreakup"
                            label="Breakup"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.3}
                        />
                        <K v={patch.backEmf} k="backEmf" label="Back EMF" min={0} max={1} step={0.01} def={0.2} />
                        <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer pb-2">
                            <input
                                type="checkbox"
                                checked={patch.cabOpenBack}
                                onChange={(e) =>
                                    setGrinderParamWithAudio('cabOpenBack' as never, e.target.checked ? 1 : 0)
                                }
                                className="size-2.5 rounded"
                                style={{ accentColor: 'rgb(217,119,6)' }}
                            />
                            Open Back
                        </label>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Level 4: Route ───────────────────────────────────────────────────────────

const RouteLevel = ({ state }: { state: GrinderState }): ReactElement => {
    const patch = state.patch;
    const routingModes = ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'] as const;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden p-3 gap-3">
            <div className="flex-1 space-y-3 overflow-y-auto">
                {/* Routing mode */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Signal Routing
                    </div>
                    <div className="flex gap-1">
                        {routingModes.map((mode) => (
                            <button
                                key={mode}
                                type="button"
                                className={`px-2 py-1 rounded text-[8px] font-medium capitalize transition-colors ${
                                    patch.routingMode === mode
                                        ? 'bg-amber-600/20 text-amber-400'
                                        : 'text-muted-foreground/50 hover:text-foreground hover:bg-surface-raised'
                                }`}
                                onClick={() =>
                                    setGrinderParamWithAudio('routingMode' as never, routingModes.indexOf(mode))
                                }
                            >
                                {mode.replace(/-/g, ' ')}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Clean blend */}
                <div className="flex gap-3">
                    <K v={patch.cleanBlend} k="cleanBlend" label="Clean Blend" min={0} max={1} step={0.01} def={0} />
                    <K v={patch.outputMix} k="outputMix" label="Wet/Dry" min={0} max={1} step={0.01} def={1} />
                </div>

                {/* Per-stage meters */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Gain Staging
                    </div>
                    <div className="grid grid-cols-4 gap-2 text-[7px] font-mono text-muted-foreground/50">
                        <div>
                            <div className="text-[6px] uppercase">Input</div>
                            <div>{formatValue(state.inputDb, 'dB')}</div>
                        </div>
                        <div>
                            <div className="text-[6px] uppercase">Preamp</div>
                            <div>{formatValue(state.preampDb, 'dB')}</div>
                        </div>
                        <div>
                            <div className="text-[6px] uppercase">Power Amp</div>
                            <div>{formatValue(state.powerAmpDb, 'dB')}</div>
                        </div>
                        <div>
                            <div className="text-[6px] uppercase">Output</div>
                            <div>{formatValue(state.outputDb, 'dB')}</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

// ── Level 5: Lab ─────────────────────────────────────────────────────────────

const LabLevel = ({ state }: { state: GrinderState }): ReactElement => {
    const patch = state.patch;

    return (
        <div className="flex flex-1 min-h-0 overflow-hidden p-3 gap-3">
            <div className="flex-1 overflow-y-auto space-y-3">
                {/* Preamp tube internals */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Preamp Tube
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <K v={patch.tubeBias} k="tubeBias" label="Bias" min={0} max={1} step={0.01} def={0.5} />
                        <K v={patch.tubeAge} k="tubeAge" label="Age" min={0} max={1} step={0.01} def={0} />
                        <K
                            v={patch.millerCapacitance}
                            k="millerCapacitance"
                            label="Miller Cap"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.5}
                        />
                        <K
                            v={patch.gridConduction}
                            k="gridConduction"
                            label="Grid Cond"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.5}
                        />
                        <K
                            v={patch.couplingCapCharge}
                            k="couplingCapCharge"
                            label="Coupling Cap"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.5}
                        />
                    </div>
                </div>

                {/* Power amp */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Power Amp
                    </div>
                    <div className="flex gap-3 flex-wrap">
                        <div className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-0.5">
                                {POWER_TUBE_TYPES.map((tube, i) => (
                                    <button
                                        key={tube}
                                        type="button"
                                        className={`px-1.5 py-0.5 rounded text-[7px] font-medium uppercase transition-colors ${
                                            patch.powerTubeType === tube
                                                ? 'bg-amber-600 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setGrinderParamWithAudio('powerTubeType' as never, i)}
                                    >
                                        {tube}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[6px] text-muted-foreground leading-none">Power Tubes</span>
                        </div>

                        <div className="flex flex-col items-center gap-0.5">
                            <div className="flex gap-0.5">
                                {RECTIFIER_TYPES.map((rect, i) => (
                                    <button
                                        key={rect}
                                        type="button"
                                        className={`px-1.5 py-0.5 rounded text-[7px] font-medium capitalize transition-colors ${
                                            patch.rectifierType === rect
                                                ? 'bg-amber-600 text-white'
                                                : 'text-muted-foreground/40 hover:text-foreground'
                                        }`}
                                        onClick={() => setGrinderParamWithAudio('rectifierType' as never, i)}
                                    >
                                        {rect}
                                    </button>
                                ))}
                            </div>
                            <span className="text-[6px] text-muted-foreground leading-none">Rectifier</span>
                        </div>

                        <K v={patch.sagAmount} k="sagAmount" label="Sag" min={0} max={1} step={0.01} def={0.4} />
                        <K
                            v={patch.sagRecovery}
                            k="sagRecovery"
                            label="Recovery"
                            min={10}
                            max={2000}
                            step={1}
                            def={200}
                            unit="ms"
                        />
                        <K v={patch.negFeedback} k="negFeedback" label="NFB" min={0} max={1} step={0.01} def={0.5} />
                        <K
                            v={patch.powerAmpBias}
                            k="powerAmpBias"
                            label="PA Bias"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.5}
                        />
                    </div>
                </div>

                {/* Transformer */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Transformer
                    </div>
                    <div className="flex gap-3">
                        <K
                            v={patch.transformerDrive}
                            k="transformerDrive"
                            label="Drive"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.3}
                        />
                        <K
                            v={patch.transformerHysteresis}
                            k="transformerHysteresis"
                            label="Hysteresis"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.3}
                        />
                        <K
                            v={patch.transformerLfSaturation}
                            k="transformerLfSaturation"
                            label="LF Sat"
                            min={0}
                            max={1}
                            step={0.01}
                            def={0.3}
                        />
                    </div>
                </div>

                {/* Neural */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Neural Capture
                    </div>
                    <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={patch.neuralEnabled}
                            onChange={(e) =>
                                setGrinderParamWithAudio('neuralEnabled' as never, e.target.checked ? 1 : 0)
                            }
                            className="size-2.5 rounded"
                            style={{ accentColor: 'rgb(217,119,6)' }}
                        />
                        Enable Neural
                    </label>
                    {patch.neuralEnabled ? (
                        <div className="flex gap-3">
                            <K v={patch.neuralMix} k="neuralMix" label="Mix" min={0} max={1} step={0.01} def={1} />
                            <div className="flex flex-col items-center gap-0.5">
                                <div className="flex gap-0.5">
                                    {['Eco', 'Balanced', 'Full'].map((label, i) => (
                                        <button
                                            key={label}
                                            type="button"
                                            className={`px-1.5 py-0.5 rounded text-[7px] font-medium transition-colors ${
                                                patch.neuralCpuBudget === i
                                                    ? 'bg-amber-600 text-white'
                                                    : 'text-muted-foreground/40 hover:text-foreground'
                                            }`}
                                            onClick={() => setGrinderParamWithAudio('neuralCpuBudget' as never, i)}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                <span className="text-[6px] text-muted-foreground leading-none">CPU Budget</span>
                            </div>
                            {state.neuralCpuPercent > 0 ? (
                                <span className="text-[7px] text-muted-foreground/40 font-mono self-end pb-1">
                                    CPU: {state.neuralCpuPercent.toFixed(0)}%
                                </span>
                            ) : null}
                        </div>
                    ) : null}
                </div>

                {/* Oversampling & anti-aliasing */}
                <div className="space-y-1">
                    <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                        Anti-Aliasing
                    </div>
                    <div className="text-[7px] text-muted-foreground/40">
                        Local oversampling + ADAA on nonlinear stages
                    </div>
                </div>

                {/* Limiter */}
                <div className="flex gap-3">
                    <label className="flex items-center gap-1 text-[8px] text-muted-foreground cursor-pointer">
                        <input
                            type="checkbox"
                            checked={patch.limiterEnabled}
                            onChange={(e) =>
                                setGrinderParamWithAudio('limiterEnabled' as never, e.target.checked ? 1 : 0)
                            }
                            className="size-2.5 rounded"
                            style={{ accentColor: 'rgb(217,119,6)' }}
                        />
                        Safety Limiter
                    </label>
                    <K
                        v={patch.limiterThreshold}
                        k="limiterThreshold"
                        label="Threshold"
                        min={-12}
                        max={0}
                        step={0.1}
                        def={-0.3}
                        unit="dB"
                    />
                </div>
            </div>

            {/* Right: Diagnostics placeholder */}
            <div className="w-[250px] shrink-0 border border-border/20 rounded-lg p-2 space-y-2">
                <div className="text-[8px] text-muted-foreground/50 font-medium uppercase tracking-wider">
                    Diagnostics
                </div>
                <div className="text-[7px] text-muted-foreground/30 space-y-1 font-mono">
                    <div>Sag: {(state.sagVoltage * 100).toFixed(1)}%</div>
                    <div>Latency: {state.latency} smp</div>
                    <div>Neural CPU: {state.neuralCpuPercent.toFixed(0)}%</div>
                    <div>Input: {formatValue(state.inputDb, 'dB')}</div>
                    <div>Preamp: {formatValue(state.preampDb, 'dB')}</div>
                    <div>Power: {formatValue(state.powerAmpDb, 'dB')}</div>
                    <div>Output: {formatValue(state.outputDb, 'dB')}</div>
                </div>
            </div>
        </div>
    );
};

// ── Main Panel ───────────────────────────────────────────────────────────────

export const GrinderPanel = (): ReactElement => {
    const state = useSyncExternalStore<GrinderState | null>(
        (cb) => grinderStore.subscribe(cb),
        () => grinderStore.value
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
                    background: 'linear-gradient(180deg, rgba(20,18,14,0.95) 0%, rgba(14,12,10,0.95) 100%)',
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
                                    ? 'bg-amber-600 text-white'
                                    : 'text-muted-foreground/60 hover:text-foreground'
                            }`}
                            onClick={() => setGrinderUiLevel(level.id)}
                            title={level.description}
                        >
                            {level.label}
                        </button>
                    ))}
                </div>

                <div className="flex-1" />

                {/* Quick meters */}
                <div className="flex items-center gap-2 text-[7px] text-muted-foreground/40 font-mono">
                    <span>In: {formatValue(state.inputDb, 'dB')}</span>
                    <span>Out: {formatValue(state.outputDb, 'dB')}</span>
                    {state.sagVoltage < 0.98 ? (
                        <span className="text-amber-500/60">Sag: {(state.sagVoltage * 100).toFixed(0)}%</span>
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
