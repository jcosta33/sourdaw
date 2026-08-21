import { type ReactElement, useEffect, useState } from 'react';

import { Cpu, Radio, Search, Sparkles, Waves } from 'lucide-react';

import { DawPluginChip } from '#/components/daw/DawPluginChip';
import { DawPluginLed } from '#/components/daw/DawPluginLed';
import { DawPluginToggle } from '#/components/daw/DawPluginToggle';
import { RotaryKnob } from '#/components/daw/RotaryKnob';
import { CompressorCurve } from '#/components/daw/visualizers/CompressorCurve';
import { DistortionCurve } from '#/components/daw/visualizers/DistortionCurve';
import { Grid, Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { useStoreSelector } from '#/infra/store/useStoreSelector';
import { trackStore, type TrackStoreState } from '#/modules/Arrangement/stores';

import {
    GRINDER_CAB_LIBRARY,
    GRINDER_NEURAL_LIBRARY,
    type GrinderAmpModel,
    type GrinderCabType,
    type GrinderEngineMode,
    type GrinderImportedNeuralModel,
    type GrinderPatch,
    type GrinderPedal,
    type GrinderPedalType,
    type GrinderPowerTubeType,
    type GrinderRectifierType,
    type GrinderUiSection,
    getGrinderSupportedChainOrder,
} from '../../models/GrinderPatch';
import {
    DEFAULT_GRINDER_NEURAL_LIBRARY_STATE,
    grinderNeuralLibraryStore,
} from '../../stores/grinderNeuralLibraryStore';
import {
    grinderStore,
    getGrinderState,
    replaceGrinderPatchLocally,
    type GrinderState,
} from '../../stores/grinderStore';
import { grinderTelemetryStore, getGrinderTelemetry, type GrinderTelemetry } from '../../stores/grinderTelemetryStore';
import { exportGrinderNeuralModel } from '../../useCases/exportGrinderNeuralModel';
import { DEFAULT_GRINDER_PEDAL_PARAMS } from '../../useCases/grinderParamBridge/helpers';
import { loadGrinderPatchWithAudio } from '../../useCases/grinderParamBridge/loadGrinderPatchWithAudio';
import { moveGrinderPedalInChainWithAudio } from '../../useCases/grinderParamBridge/moveGrinderPedalInChainWithAudio';
import { recallGrinderSnapshotWithAudio } from '../../useCases/grinderParamBridge/recallGrinderSnapshotWithAudio';
import { setGrinderMicParamWithAudio } from '../../useCases/grinderParamBridge/setGrinderMicParamWithAudio';
import { setGrinderParamWithAudio } from '../../useCases/grinderParamBridge/setGrinderParamWithAudio';
import { setGrinderPedalParamWithAudio } from '../../useCases/grinderParamBridge/setGrinderPedalParamWithAudio';
import { GRINDER_PRESETS } from '../../useCases/grinderPresets';
import { hydrateGrinderPatchFromProject } from '../../useCases/hydrateGrinderPatchFromProject';
import { importGrinderNeuralModels } from '../../useCases/importGrinderNeuralModels';
import { removeGrinderNeuralModel } from '../../useCases/removeGrinderNeuralModel';
import { restoreGrinderNeuralLibrary } from '../../useCases/restoreGrinderNeuralLibrary';
import { ImportedNeuralLibraryCard } from '../components/ImportedNeuralLibraryCard';

const SECTION_TABS: ReadonlyArray<{ id: GrinderUiSection; label: string; icon: typeof Sparkles }> = [
    { id: 'browse', label: 'Browse', icon: Search },
    { id: 'amp', label: 'Amp', icon: Radio },
    { id: 'drive', label: 'Drive', icon: Waves },
    { id: 'cab', label: 'Cab', icon: Sparkles },
    { id: 'neural', label: 'Neural', icon: Cpu },
    { id: 'lab', label: 'Lab', icon: Sparkles },
];

function selectProjectParameterValues(state: TrackStoreState | null, deviceId: string): Record<string, number> | null {
    for (const track of state?.tracks ?? []) {
        const device = track.devices.find((candidate) => candidate.id === deviceId);
        if (device) {
            return device.parameterValues;
        }
    }
    return null;
}

const ENGINE_MODES: ReadonlyArray<{ id: GrinderEngineMode; label: string; description: string }> = [
    { id: 'circuit', label: 'Circuit', description: 'Full amp controls, no capture in the loop' },
    { id: 'capture', label: 'Capture', description: 'Run the loaded capture and keep the amp mostly out of it' },
    { id: 'hybrid', label: 'Hybrid', description: 'Blend the circuit path with the loaded capture' },
];

const AMP_MODELS: ReadonlyArray<{
    id: GrinderAmpModel;
    label: string;
    family: string;
    voicing: string;
    tubes: string;
    accent: string;
}> = [
    {
        id: 'clean-twin',
        label: 'Clean Twin',
        family: 'American',
        voicing: 'Headroom, bloom, glass',
        tubes: '6L6',
        accent: 'var(--color-accent-amber)',
    },
    {
        id: 'crunch-jcm',
        label: 'Crunch JCM',
        family: 'British',
        voicing: 'Mid-forward rock bite',
        tubes: 'EL34',
        accent: 'var(--color-accent-orange)',
    },
    {
        id: 'lead-jcm',
        label: 'Lead JCM',
        family: 'British',
        voicing: 'Focused sustain and cut',
        tubes: 'EL34',
        accent: 'var(--color-accent-peach)',
    },
    {
        id: 'ac30-tb',
        label: 'AC30 Top Boost',
        family: 'Class A',
        voicing: 'Chime, sparkle, chew',
        tubes: 'EL84',
        accent: 'var(--color-accent-cyan)',
    },
    {
        id: 'rectifier',
        label: 'Rectifier',
        family: 'Modern',
        voicing: 'Dense low end and grind',
        tubes: '6L6',
        accent: 'var(--color-accent-lavender)',
    },
    {
        id: 'custom',
        label: 'Custom',
        family: 'Lab',
        voicing: 'Open-ended voicing lab',
        tubes: 'Any',
        accent: 'var(--color-accent-orange)',
    },
];

const POWER_TUBES: readonly GrinderPowerTubeType[] = ['6l6', 'el34', 'el84'];
const RECTIFIERS: readonly GrinderRectifierType[] = ['tube', 'solid-state', 'variac'];
const CAB_MODES: ReadonlyArray<{ id: GrinderCabType; label: string; description: string }> = [
    { id: 'ir', label: 'IR', description: 'Cabinet IR only' },
    { id: 'parametric', label: 'Parametric', description: 'Speaker model only' },
    { id: 'both', label: 'Both', description: 'IR and speaker shaping' },
];
const ROUTING_PRESETS: ReadonlyArray<{
    id: GrinderPatch['routingMode'];
    label: string;
    description: string;
}> = [
    { id: 'serial', label: 'Serial', description: 'Single straight cab lane.' },
    { id: 'parallel', label: 'Parallel', description: 'Blend the selected cab lane with a parallel contrast lane.' },
    { id: 'wet-dry-wet', label: 'Wet/Dry/Wet', description: 'Keep a dry core under the cabinet lanes.' },
    { id: 'dual-amp', label: 'Dual Amp', description: 'Run a contrasting second derived amp lane.' },
];

function get_engine_mode_label(engine_mode: GrinderEngineMode): string {
    return ENGINE_MODES.find((mode) => mode.id === engine_mode)?.label ?? 'Circuit';
}

function get_neural_placement_label(placement: GrinderPatch['neuralPlacement']): string {
    return placement === 'amp-capture' ? 'Amp capture' : 'Rig capture';
}

function get_neural_path_status(patch: GrinderPatch): string {
    if (patch.engineMode === 'circuit') {
        return 'Circuit amp only. Neural capture is bypassed.';
    }
    if (patch.engineMode === 'capture') {
        return patch.neuralPlacement === 'amp-capture'
            ? 'Capture replaces the amp stage while the rest of the rig stays in line.'
            : 'Capture stands in for the full rig path.';
    }

    return patch.neuralPlacement === 'amp-capture'
        ? `Circuit amp and capture are blended at ${Math.round(patch.neuralMix * 100)}%.`
        : 'Circuit amp feeds the rig chain while the capture provides the full rig voice.';
}

function get_cab_voice_label(cab_ir_id: string): string {
    return GRINDER_CAB_LIBRARY.find((cabinet) => cabinet.id === cab_ir_id)?.label ?? '4x12 Tight';
}

function get_cab_mode_label(cab_type: GrinderCabType): string {
    return CAB_MODES.find((mode) => mode.id === cab_type)?.label ?? 'Both';
}

function get_routing_preset_label(routing_mode: GrinderPatch['routingMode']): string {
    return ROUTING_PRESETS.find((mode) => mode.id === routing_mode)?.label ?? 'Serial';
}

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

const DRIVE_CONTROLS: readonly SupportedPedalControl[] = [
    {
        label: 'Compressor',
        type: 'compressor',
        defaults: {
            id: 'comp1',
            type: 'compressor',
            enabled: false,
            params: { ...DEFAULT_GRINDER_PEDAL_PARAMS.compressor },
        },
        params: [
            {
                key: 'threshold',
                label: 'Threshold',
                min: -40,
                max: 0,
                step: 1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.compressor.threshold,
                unit: 'dB',
            },
            {
                key: 'ratio',
                label: 'Ratio',
                min: 1,
                max: 8,
                step: 0.5,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.compressor.ratio,
            },
            {
                key: 'attack',
                label: 'Attack',
                min: 1,
                max: 50,
                step: 1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.compressor.attack,
                unit: 'ms',
            },
            {
                key: 'release',
                label: 'Release',
                min: 50,
                max: 400,
                step: 5,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.compressor.release,
                unit: 'ms',
            },
        ],
    },
    {
        label: 'Overdrive',
        type: 'overdrive',
        defaults: {
            id: 'od1',
            type: 'overdrive',
            enabled: false,
            params: { ...DEFAULT_GRINDER_PEDAL_PARAMS.overdrive },
        },
        params: [
            {
                key: 'drive',
                label: 'Drive',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.drive,
            },
            {
                key: 'tone',
                label: 'Tone',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.tone,
            },
            {
                key: 'level',
                label: 'Level',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.level,
            },
        ],
    },
    {
        label: 'Distortion',
        type: 'distortion',
        defaults: {
            id: 'dist1',
            type: 'distortion',
            enabled: false,
            params: { ...DEFAULT_GRINDER_PEDAL_PARAMS.distortion },
        },
        params: [
            {
                key: 'drive',
                label: 'Drive',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.distortion.drive,
            },
            {
                key: 'tone',
                label: 'Tone',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.distortion.tone,
            },
            {
                key: 'level',
                label: 'Level',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.distortion.level,
            },
        ],
    },
    {
        label: 'Fuzz',
        type: 'fuzz',
        defaults: { id: 'fuzz1', type: 'fuzz', enabled: false, params: { ...DEFAULT_GRINDER_PEDAL_PARAMS.fuzz } },
        params: [
            {
                key: 'fuzz',
                label: 'Fuzz',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.fuzz,
            },
            {
                key: 'tone',
                label: 'Tone',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.tone,
            },
            {
                key: 'level',
                label: 'Level',
                min: 0,
                max: 10,
                step: 0.1,
                defaultValue: DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.level,
            },
        ],
    },
];

function formatValue(value: number, unit = ''): string {
    if (unit === 'dB') {
        return `${value > 0 ? '+' : ''}${value.toFixed(1)} dB`;
    }
    if (unit === 'ms') {
        return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`;
    }
    if (unit === 'Hz') {
        return value >= 1000 ? `${(value / 1000).toFixed(1)} kHz` : `${value.toFixed(0)} Hz`;
    }
    if (unit === 'kΩ') {
        return value >= 1000 ? `${(value / 1000).toFixed(1)} MΩ` : `${value.toFixed(0)} kΩ`;
    }
    if (unit === '%') {
        return `${value.toFixed(0)}%`;
    }
    return value.toFixed(1);
}

function get_drive_control_for_pedal_type(pedal_type: GrinderPedalType): SupportedPedalControl | undefined {
    return DRIVE_CONTROLS.find((control) => control.type === pedal_type);
}

function toDbPercent(db: number): number {
    return Math.max(0, Math.min(1, (db + 72) / 72));
}

function GrinderKnob({
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
    param: keyof GrinderPatch;
    label: string;
    min: number;
    max: number;
    step: number;
    defaultValue: number;
    unit?: string;
}): ReactElement {
    return (
        <Stack
            align="center"
            gap={1}
            className="min-w-[72px] rounded-[18px] border border-white/8 bg-[var(--color-bg-panelInset)] px-3 py-3 shadow-[var(--shadow-elevation-inset)]"
        >
            <RotaryKnob
                value={value}
                onChange={(next) => setGrinderParamWithAudio(deviceId, param, next)}
                min={min}
                max={max}
                step={step}
                defaultValue={defaultValue}
                size="sm"
                aria-label={label}
            />
            <span className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]">{label}</span>
            <span className="font-mono text-[10px] text-white/55">{formatValue(value, unit)}</span>
        </Stack>
    );
}

function StatusMeter({ label, value, accent }: { label: string; value: number; accent: string }): ReactElement {
    return (
        <Stack gap={1.5} className="grinder-window min-w-[68px] px-2.5 py-2">
            <div className="text-[9px] uppercase tracking-[0.24em] text-white/48">{label}</div>
            <div className="h-1.5 overflow-hidden rounded-full bg-white/6">
                <div
                    className="h-full rounded-full transition-all duration-[40ms]"
                    style={{ width: `${Math.max(0, Math.min(100, value * 100))}%`, background: accent }}
                />
            </div>
        </Stack>
    );
}

function GrinderTelemetryMeter({
    deviceId,
    label,
    telemetryKey,
    accent,
    transform = (value1) => value1,
}: {
    deviceId: string;
    label: string;
    telemetryKey: keyof GrinderTelemetry;
    accent: string;
    transform?: (v: number) => number;
}): ReactElement {
    const allTelemetry = useStore(grinderTelemetryStore, {});
    const telemetry = allTelemetry?.[deviceId] ?? getGrinderTelemetry(deviceId);
    const value = telemetry[telemetryKey];

    return <StatusMeter label={label} value={transform(value)} accent={accent} />;
}

function ToneResponseStage({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    const points = [
        [0, 78 - patch.bass * 4],
        [24, 64 - patch.bass * 2],
        [45, 60 - patch.mid * 3.6],
        [68, 64 - patch.treble * 3.4],
        [100, 70 - patch.presence * 2.8],
    ];

    let ampStageLed = 'Classic';
    if (patch.bright) {
        ampStageLed = 'Bright';
    } else if (patch.fat) {
        ampStageLed = 'Fat';
    }

    return (
        <Stack gap={3} className="grinder-window h-full p-3">
            <Row align="start" justify="between">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]">
                        Amp Stage
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white/90">
                        {AMP_MODELS.find((model) => model.id === patch.ampModel)?.label ?? 'Custom'}
                    </div>
                    <div className="text-xs text-white/45">
                        Channel {patch.channel + 1} · {patch.powerTubeType.toUpperCase()} · {patch.rectifierType}
                    </div>
                </div>
                <DawPluginLed tone="amber">{ampStageLed}</DawPluginLed>
            </Row>
            <Row grow gap={3} className="min-h-0">
                <svg
                    viewBox="0 0 100 84"
                    className="h-full flex-1 rounded-[18px] bg-black/35 p-2"
                    preserveAspectRatio="none"
                    aria-label="Tone stack response"
                >
                    <defs>
                        <linearGradient id="grinder-tone-fill" x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor="rgba(229,168,75,0.30)" />
                            <stop offset="100%" stopColor="rgba(229,168,75,0.02)" />
                        </linearGradient>
                    </defs>
                    <rect x="0" y="0" width="100" height="84" rx="8" fill="rgba(255,255,255,0.02)" />
                    <path d="M 0 42 L 100 42" stroke="rgba(255,255,255,0.08)" strokeDasharray="2 3" />
                    <path d="M 50 8 L 50 76" stroke="rgba(255,255,255,0.05)" strokeDasharray="2 3" />
                    <path
                        d={`M ${points.map(([x, y]) => `${x} ${y}`).join(' L ')}`}
                        fill="none"
                        stroke="var(--color-accent-amber)"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <path
                        d={`M ${points[0]?.[0] ?? 0} 84 L ${points.map(([x, y]) => `${x} ${y}`).join(' L ')} L ${points[points.length - 1]?.[0] ?? 100} 84 Z`}
                        fill="url(#grinder-tone-fill)"
                    />
                </svg>
                <Stack gap={3} shrink={false}>
                    <GrinderTelemetryMeter
                        deviceId={deviceId}
                        label="Input"
                        telemetryKey="inputDb"
                        accent="var(--color-accent-cyan)"
                        transform={toDbPercent}
                    />
                    <GrinderTelemetryMeter
                        deviceId={deviceId}
                        label="Pre"
                        telemetryKey="preampDb"
                        accent="var(--color-accent-amber)"
                        transform={toDbPercent}
                    />
                    <GrinderTelemetryMeter
                        deviceId={deviceId}
                        label="Power"
                        telemetryKey="powerAmpDb"
                        accent="var(--color-accent-peach)"
                        transform={toDbPercent}
                    />
                </Stack>
            </Row>
        </Stack>
    );
}

function DriveStage({ patch }: { patch: GrinderPatch }): ReactElement {
    const compressor = patch.prePedals.find((pedal) => pedal.type === 'compressor');
    const drivePedal =
        patch.prePedals.find((pedal) => pedal.type === 'distortion') ??
        patch.prePedals.find((pedal) => pedal.type === 'overdrive') ??
        patch.prePedals.find((pedal) => pedal.type === 'fuzz');

    const driveAmount = drivePedal?.params.drive ?? drivePedal?.params.fuzz ?? 0;
    const toneAmount = drivePedal?.params.tone ?? 5;
    const driveMix = patch.outputMix;

    return (
        <div className="grid h-full grid-cols-[1.1fr_0.9fr] gap-3">
            <Stack gap={3} className="grinder-window p-3">
                <Row align="start" justify="between">
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-peach)]">
                            Drive Surface
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white/90">
                            {drivePedal?.type ?? 'No drive block'}
                        </div>
                    </div>
                    <DawPluginLed tone="amber">{drivePedal?.enabled ? 'Live' : 'Bypassed'}</DawPluginLed>
                </Row>
                <DistortionCurve
                    drive={driveAmount * 10}
                    tone={toneAmount * 800}
                    mix={driveMix}
                    width={320}
                    height={152}
                />
                <Grid cols={3} gap={3}>
                    <StatusMeter
                        label="OD"
                        value={(patch.prePedals.find((pedal) => pedal.type === 'overdrive')?.params.drive ?? 0) / 10}
                        accent="var(--color-accent-amber)"
                    />
                    <StatusMeter
                        label="Dist"
                        value={(patch.prePedals.find((pedal) => pedal.type === 'distortion')?.params.drive ?? 0) / 10}
                        accent="var(--color-accent-peach)"
                    />
                    <StatusMeter
                        label="Fuzz"
                        value={(patch.prePedals.find((pedal) => pedal.type === 'fuzz')?.params.fuzz ?? 0) / 10}
                        accent="var(--color-accent-lavender)"
                    />
                </Grid>
            </Stack>
            <Stack gap={3} className="grinder-window p-3">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]">
                        Sustain
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white/90">Gate and squeeze</div>
                </div>
                <CompressorCurve
                    threshold={compressor?.params.threshold ?? patch.gateThreshold}
                    ratio={compressor?.params.ratio ?? 2}
                    knee={6}
                    makeup={0}
                    width={210}
                    height={152}
                />
                <Grid cols={2} gap={3}>
                    <StatusMeter label="Gate" value={patch.gateEnabled ? 1 : 0} accent="var(--color-accent-cyan)" />
                    <StatusMeter label="Comp" value={compressor?.enabled ? 1 : 0} accent="var(--color-accent-peach)" />
                </Grid>
            </Stack>
        </div>
    );
}
function CabStage({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    const handleDrag = (micIndex: 1 | 2, event: React.MouseEvent) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const x = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
        const y = Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height));

        setGrinderMicParamWithAudio(deviceId, micIndex, 'positionX', x);
        setGrinderMicParamWithAudio(deviceId, micIndex, 'positionY', y);
    };

    return (
        <div className="grid h-full grid-cols-[1.05fr_0.95fr] gap-3">
            <Stack gap={3} className="grinder-window p-3">
                <Row align="start" justify="between">
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]">
                            Cab stage
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white/90">Speaker field</div>
                    </div>
                    <DawPluginLed tone="amber">{patch.cabEnabled ? 'Cab In' : 'Cab Out'}</DawPluginLed>
                </Row>
                <Row
                    justify="center"
                    className="relative h-[180px] w-full overflow-hidden rounded-[20px] border border-white/8 bg-[radial-gradient(circle_at_50%_42%,rgba(111,177,198,0.18),transparent_34%),radial-gradient(circle_at_50%_50%,rgba(229,168,75,0.14),transparent_54%),linear-gradient(180deg,rgba(255,255,255,0.03),rgba(255,255,255,0.01))]"
                    aria-label="Speaker field preview"
                    onMouseMove={(event) => {
                        if (event.buttons === 1) {
                            handleDrag(1, event);
                        }
                    }}
                >
                    <div className="absolute inset-[14%] rounded-full border border-white/8" />
                    <div className="absolute inset-[24%] rounded-full border border-white/12" />
                    <div className="absolute inset-[36%] rounded-full border border-[var(--color-accent-amber)]/30" />
                    <Row
                        justify="center"
                        className="absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-[var(--color-accent-cyan)]/60 bg-[var(--color-accent-cyan)]/18 shadow-[0_0_24px_rgba(111,177,198,0.25)]"
                        style={{ left: `${patch.mic1.positionX * 100}%`, top: `${patch.mic1.positionY * 100}%` }}
                    >
                        <span className="text-[10px] font-semibold text-[var(--color-accent-cyan)]">1</span>
                    </Row>
                    {patch.mic2.enabled ? (
                        <Row
                            justify="center"
                            className="absolute size-5 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border border-[var(--color-accent-peach)]/60 bg-[var(--color-accent-peach)]/18"
                            style={{ left: `${patch.mic2.positionX * 100}%`, top: `${patch.mic2.positionY * 100}%` }}
                            onMouseDown={(event) => event.stopPropagation()}
                        >
                            <span className="text-[10px] font-semibold text-[var(--color-accent-peach)]">2</span>
                        </Row>
                    ) : null}
                </Row>
                <Grid cols={3} gap={3}>
                    <StatusMeter label="Thump" value={patch.backEmf} accent="var(--color-accent-cyan)" />
                    <StatusMeter label="Breakup" value={patch.coneBreakup} accent="var(--color-accent-peach)" />
                    <StatusMeter label="Damp" value={patch.cabDamping} accent="var(--color-accent-lavender)" />
                </Grid>
                <Row align="stretch" gap={2}>
                    <Stack gap={1}>
                        <span className="text-[9px] uppercase text-white/30 tracking-wider font-semibold">Mic 1</span>
                        <Row align="stretch" gap={2}>
                            <RotaryKnob
                                value={patch.mic1.positionX}
                                onChange={(value) => setGrinderMicParamWithAudio(deviceId, 1, 'positionX', value)}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.3}
                                size="sm"
                            />
                            <RotaryKnob
                                value={patch.mic1.positionY}
                                onChange={(value) => setGrinderMicParamWithAudio(deviceId, 1, 'positionY', value)}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.1}
                                size="sm"
                            />
                            <RotaryKnob
                                value={patch.mic1.distance}
                                onChange={(value) => setGrinderMicParamWithAudio(deviceId, 1, 'distance', value)}
                                min={0}
                                max={1}
                                step={0.01}
                                defaultValue={0.2}
                                size="sm"
                            />
                        </Row>
                    </Stack>
                    {patch.mic2.enabled ? (
                        <Stack gap={1}>
                            <span className="text-[9px] uppercase text-white/30 tracking-wider font-semibold">
                                Mic 2
                            </span>
                            <Row align="stretch" gap={2}>
                                <RotaryKnob
                                    value={patch.mic2.positionX}
                                    onChange={(value) => setGrinderMicParamWithAudio(deviceId, 2, 'positionX', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.6}
                                    size="sm"
                                />
                                <RotaryKnob
                                    value={patch.mic2.positionY}
                                    onChange={(value) => setGrinderMicParamWithAudio(deviceId, 2, 'positionY', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.3}
                                    size="sm"
                                />
                                <RotaryKnob
                                    value={patch.mic2.distance}
                                    onChange={(value) => setGrinderMicParamWithAudio(deviceId, 2, 'distance', value)}
                                    min={0}
                                    max={1}
                                    step={0.01}
                                    defaultValue={0.5}
                                    size="sm"
                                />
                            </Row>
                        </Stack>
                    ) : null}
                </Row>
            </Stack>
            <Stack gap={3} className="grinder-window p-3">
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]">
                    Cab notes
                </div>
                <div className="rounded-[20px] border border-white/8 bg-black/30 p-3">
                    <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Readout</div>
                    <Stack gap={1.5} className="mt-2 font-mono text-[12px] text-white/70">
                        <div>voice {get_cab_voice_label(patch.cabIrId)}</div>
                        <div>mode {get_cab_mode_label(patch.cabType)}</div>
                        <div>route {get_routing_preset_label(patch.routingMode)}</div>
                        <div>mic-x {patch.mic1.positionX.toFixed(2)}</div>
                        <div>mic-y {patch.mic1.positionY.toFixed(2)}</div>
                        <div>damp {patch.cabDamping.toFixed(2)}</div>
                        <div>res-q {patch.cabResonanceQ.toFixed(2)}</div>
                    </Stack>
                </div>
            </Stack>
        </div>
    );
}

function NeuralStage({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    const modelName = patch.neuralModelName || 'Factory Voice A';
    const statusLabel = patch.engineMode === 'circuit' ? 'Idle' : 'Active';

    return (
        <div className="grid h-full grid-cols-[1fr_0.94fr] gap-3">
            <Stack gap={3} className="grinder-window p-3">
                <Row align="start" justify="between">
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-lavender)]">
                            Capture engine
                        </div>
                        <div className="mt-1 text-lg font-semibold text-white/90">{modelName}</div>
                        <div className="text-xs text-white/45">
                            {patch.neuralModelFamily} ·{' '}
                            {patch.neuralPlacement === 'amp-capture' ? 'Amp capture' : 'Rig capture'}
                        </div>
                    </div>
                    <DawPluginLed tone="amber">{statusLabel}</DawPluginLed>
                </Row>
                <div className="rounded-[20px] border border-white/8 bg-black/35 p-4">
                    <Row justify="between" className="text-[10px] uppercase tracking-[0.24em] text-white/46">
                        <span>Blend</span>
                        <span>{Math.round(patch.neuralMix * 100)}%</span>
                    </Row>
                    <div className="mt-3 h-3 overflow-hidden rounded-full bg-white/6">
                        <div
                            className="h-full rounded-full bg-[linear-gradient(90deg,var(--color-accent-lavender),var(--color-accent-cyan))]"
                            style={{ width: `${patch.neuralMix * 100}%` }}
                        />
                    </div>
                    <Grid cols={2} gap={2} className="mt-4">
                        <GrinderTelemetryMeter
                            deviceId={deviceId}
                            label="CPU"
                            telemetryKey="neuralCpuPercent"
                            accent="var(--color-accent-lavender)"
                            transform={(value) => value / 100}
                        />
                        <GrinderTelemetryMeter
                            deviceId={deviceId}
                            label="Warm"
                            telemetryKey="neuralWarmupProgress"
                            accent="var(--color-accent-cyan)"
                        />
                    </Grid>
                </div>
            </Stack>
            <Stack gap={3} className="grinder-window p-3">
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]">
                    Signal path
                </div>
                <div className="grid gap-2">
                    <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Mode</div>
                        <div className="mt-1 text-sm font-medium text-white/88">
                            {get_engine_mode_label(patch.engineMode)}
                        </div>
                    </div>
                    <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Placement</div>
                        <div className="mt-1 text-sm font-medium text-white/88">
                            {get_neural_placement_label(patch.neuralPlacement)}
                        </div>
                    </div>
                    <div className="rounded-[16px] border border-white/8 bg-black/20 px-3 py-2.5">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-white/45">Status</div>
                        <div className="mt-1 text-xs leading-5 text-white/60">{get_neural_path_status(patch)}</div>
                    </div>
                    <div className="rounded-[16px] border border-dashed border-[var(--color-accent-cyan)]/25 bg-[var(--color-accent-cyan)]/6 px-3 py-2.5 text-xs leading-5 text-white/62">
                        Selecting a library voice now swaps the active built-in capture profile in the live DSP path.
                    </div>
                </div>
            </Stack>
        </div>
    );
}

function TelemetryReadout({ deviceId }: { deviceId: string }): ReactElement {
    const allTelemetry = useStore(grinderTelemetryStore, {});
    const telemetry = allTelemetry?.[deviceId] ?? getGrinderTelemetry(deviceId);
    return (
        <>
            <div>gate-env {telemetry.gateEnvelopeDb.toFixed(1)} dB</div>
            <div>latency {telemetry.latency.toFixed(0)} smp</div>
        </>
    );
}

function NeuralTelemetryReadout({ deviceId }: { deviceId: string }): ReactElement {
    const allTelemetry = useStore(grinderTelemetryStore, {});
    const telemetry = allTelemetry?.[deviceId] ?? getGrinderTelemetry(deviceId);
    return (
        <>
            Warmup {Math.round(telemetry.neuralWarmupProgress * 100)}% · CPU {Math.round(telemetry.neuralCpuPercent)}%
        </>
    );
}

function QuickTelemetryReadout({ deviceId }: { deviceId: string }): ReactElement {
    const allTelemetry = useStore(grinderTelemetryStore, {});
    const telemetry = allTelemetry?.[deviceId] ?? getGrinderTelemetry(deviceId);
    return (
        <>
            <div className="font-mono text-sm text-white/62">gate {Math.round(telemetry.gateOpen * 100)}%</div>
            <div className="font-mono text-sm text-white/62">sag {telemetry.sagVoltage.toFixed(2)}</div>
            <div className="font-mono text-sm text-white/62">out {telemetry.outputDb.toFixed(1)} dB</div>
        </>
    );
}

function LabStage({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    return (
        <div className="grid h-full grid-cols-[0.92fr_1.08fr] gap-3">
            <Stack gap={3} className="grinder-window p-3">
                <div>
                    <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-orange)]">
                        Diagnostics
                    </div>
                    <div className="mt-1 text-lg font-semibold text-white/90">Feel check</div>
                </div>
                <GrinderTelemetryMeter
                    deviceId={deviceId}
                    label="Gate"
                    telemetryKey="gateOpen"
                    accent="var(--color-accent-cyan)"
                />
                <GrinderTelemetryMeter
                    deviceId={deviceId}
                    label="Sag"
                    telemetryKey="sagVoltage"
                    accent="var(--color-accent-orange)"
                    transform={(value) => Math.max(0, Math.min(1, value))}
                />
                <GrinderTelemetryMeter
                    deviceId={deviceId}
                    label="Output"
                    telemetryKey="outputDb"
                    accent="var(--color-accent-peach)"
                    transform={toDbPercent}
                />
                <div className="rounded-[20px] border border-white/8 bg-black/25 p-3 font-mono text-[12px] text-white/62">
                    <TelemetryReadout deviceId={deviceId} />
                    <div>xformer {patch.transformerDrive.toFixed(2)}</div>
                    <div>nfb {patch.negFeedback.toFixed(2)}</div>
                </div>
            </Stack>
            <Stack gap={3} className="grinder-window p-3">
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]">
                    What lives here
                </div>
                <Grid cols={2} gap={3}>
                    <StatusMeter
                        label="Bias"
                        value={Math.max(0, Math.min(1, patch.tubeBias))}
                        accent="var(--color-accent-orange)"
                    />
                    <StatusMeter
                        label="NFB"
                        value={Math.max(0, Math.min(1, patch.negFeedback))}
                        accent="var(--color-accent-amber)"
                    />
                </Grid>
            </Stack>
        </div>
    );
}

function BrowserRail({
    deviceId,
    patch,
    replacePatch,
}: {
    deviceId: string;
    patch: GrinderPatch;
    replacePatch: (next: GrinderPatch) => void;
}): ReactElement {
    const [query, setQuery] = useState('');
    const [category, setCategory] = useState('All');
    const categories = ['All', ...Array.from(new Set(GRINDER_PRESETS.map((preset) => preset.category)))];
    const lowered_query = query.toLowerCase();
    const filteredPresets = GRINDER_PRESETS.filter((preset) => {
        const matchesCategory = category === 'All' || preset.category === category;
        const haystack = `${preset.name} ${preset.category}`.toLowerCase();
        return matchesCategory && haystack.includes(lowered_query);
    });

    return (
        <Stack as="aside" gap={3} shrink={false} className="grinder-faceplate h-full w-[296px] overflow-y-auto p-3">
            <div>
                <div className="text-[10px] uppercase tracking-[0.3em] text-[var(--color-accent-amber)]">Grinder</div>
                <div className="mt-1 text-[22px] font-semibold tracking-[0.03em] text-white/92">Presets</div>
            </div>
            <Stack grow gap={2.5} className="grinder-window p-3">
                <Row as="label" gap={2} className="rounded-[18px] border border-white/6 bg-black/20 px-3 py-2">
                    <Search className="size-4 text-white/40" />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        className="w-full bg-transparent text-sm text-white/84 outline-none placeholder:text-white/28"
                        placeholder="Search presets"
                        aria-label="Search Grinder presets"
                    />
                </Row>
                <Row justify="between" className="text-[10px] uppercase tracking-[0.22em] text-white/34">
                    <span>{category}</span>
                    <span>{filteredPresets.length} shown</span>
                </Row>
                <Row align="stretch" wrap gap={2}>
                    {categories.map((item) => (
                        <DawPluginChip
                            key={item}
                            active={category === item}
                            tone="amber"
                            size="sm"
                            onClick={() => setCategory(item)}
                        >
                            {item}
                        </DawPluginChip>
                    ))}
                </Row>
                {patch.snapshots.length > 0 ? (
                    <div className="rounded-[18px] border border-white/8 bg-black/20 p-3">
                        <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent-cyan)]">
                            Snapshots
                        </div>
                        <Row align="stretch" wrap gap={2} className="mt-2">
                            {patch.snapshots.map((snapshot, index) => (
                                <DawPluginToggle
                                    key={snapshot.id}
                                    pressed={patch.activeSnapshot === index}
                                    tone="cyan"
                                    size="sm"
                                    caps={false}
                                    onClick={() => recallGrinderSnapshotWithAudio(deviceId, index)}
                                >
                                    {snapshot.name}
                                </DawPluginToggle>
                            ))}
                        </Row>
                    </div>
                ) : null}
                <Stack grow gap={1.5} className="overflow-y-auto pr-1">
                    {filteredPresets.length > 0 ? (
                        filteredPresets.map((preset) => (
                            <Button
                                variant="bare"
                                size="bare"
                                key={preset.id}
                                type="button"
                                className={`grinder-window flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left ${
                                    patch.name === preset.patch.name
                                        ? 'border-[var(--color-accent-amber)]/60 bg-[var(--color-accent-amber)]/10'
                                        : ''
                                }`}
                                onClick={() => replacePatch({ ...preset.patch, uiSection: patch.uiSection })}
                            >
                                <Row justify="between" gap={3} className="w-full">
                                    <span className="text-[13px] font-medium text-white/88">{preset.name}</span>
                                    <span className="text-[9px] uppercase tracking-[0.2em] text-white/36">
                                        {preset.category}
                                    </span>
                                </Row>
                                <span className="text-[11px] text-white/45">
                                    {preset.patch.ampModel === 'clean-twin'
                                        ? 'Clean platform'
                                        : (AMP_MODELS.find((amp) => amp.id === preset.patch.ampModel)?.label ??
                                          'House preset')}
                                </span>
                            </Button>
                        ))
                    ) : (
                        <div className="rounded-[18px] border border-dashed border-white/10 bg-black/18 px-4 py-4 text-[13px] text-white/46">
                            Nothing matches that search. Clear it or try another tray.
                        </div>
                    )}
                </Stack>
            </Stack>
            <Stack gap={2} className="grinder-window max-h-[24vh] overflow-y-auto p-3">
                <div className="text-[10px] uppercase tracking-[0.22em] text-[var(--color-accent-cyan)]">
                    Amp lineup
                </div>
                <div className="grid gap-2">
                    {AMP_MODELS.map((amp) => (
                        <Button
                            variant="bare"
                            size="bare"
                            key={amp.id}
                            type="button"
                            className={`rounded-[18px] border px-3 py-2.5 text-left transition-colors ${
                                patch.ampModel === amp.id ? 'border-white/18 bg-white/6' : 'border-white/8 bg-black/16'
                            }`}
                            onClick={() => replacePatch({ ...patch, ampModel: amp.id })}
                        >
                            <Row justify="between">
                                <span className="text-[13px] font-medium text-white/90">{amp.label}</span>
                                <span className="h-2 w-2 rounded-full" style={{ background: amp.accent }} />
                            </Row>
                            <div className="mt-1 text-[10px] uppercase tracking-[0.22em] text-white/34">
                                {amp.family} · {amp.tubes}
                            </div>
                            <div className="mt-2 text-xs text-white/46">{amp.voicing}</div>
                        </Button>
                    ))}
                </div>
            </Stack>
        </Stack>
    );
}

function SectionTabs({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    return (
        <Row align="stretch" wrap gap={1.5}>
            {SECTION_TABS.map((tab) => {
                const Icon = tab.icon;
                const active = patch.uiSection === tab.id;
                return (
                    <Button
                        variant="bare"
                        size="bare"
                        key={tab.id}
                        type="button"
                        className={`grinder-tab ${active ? 'grinder-tab-active' : ''}`}
                        onClick={() => replaceGrinderPatchLocally(deviceId, { ...patch, uiSection: tab.id })}
                    >
                        <Icon className="size-3.5" />
                        <span>{tab.label}</span>
                    </Button>
                );
            })}
        </Row>
    );
}

function DriveDeck({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    const chain_order = getGrinderSupportedChainOrder(patch.prePedals, { include_missing: false });

    return (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="grinder-window flex flex-col gap-3 p-3 md:col-span-2 xl:col-span-4">
                <Row justify="between" gap={3}>
                    <div>
                        <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]">
                            Chain order
                        </div>
                        <div className="mt-1 text-sm text-white/56">
                            Supported front-end pedals move in the live signal path.
                        </div>
                    </div>
                    <DawPluginLed tone="amber">{chain_order.length > 0 ? 'Live' : 'Empty'}</DawPluginLed>
                </Row>
                {chain_order.length > 0 ? (
                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-4">
                        {chain_order.map((pedal_type, index) => {
                            const control = get_drive_control_for_pedal_type(pedal_type);
                            if (!control) {
                                return null;
                            }

                            const pedal = patch.prePedals.find((item) => item.type === pedal_type) ?? control.defaults;
                            return (
                                <div
                                    key={`chain-${pedal_type}`}
                                    className="rounded-[18px] border border-white/8 bg-black/20 p-3"
                                >
                                    <Row gap={2}>
                                        <DawPluginToggle
                                            pressed={pedal.enabled}
                                            tone="amber"
                                            size="sm"
                                            caps={false}
                                            className="min-w-0 flex-1 justify-start"
                                            onClick={() =>
                                                setGrinderPedalParamWithAudio(
                                                    deviceId,
                                                    false,
                                                    pedal_type,
                                                    'enabled',
                                                    pedal.enabled ? 0 : 1,
                                                    control.defaults
                                                )
                                            }
                                        >
                                            {`${index + 1} ${control.label}`}
                                        </DawPluginToggle>
                                        <DawPluginChip
                                            tone="steel"
                                            size="sm"
                                            caps={false}
                                            disabled={index === 0}
                                            aria-label={`Move ${control.label} left`}
                                            onClick={() =>
                                                moveGrinderPedalInChainWithAudio(deviceId, false, pedal_type, 'left')
                                            }
                                        >
                                            Left
                                        </DawPluginChip>
                                        <DawPluginChip
                                            tone="steel"
                                            size="sm"
                                            caps={false}
                                            disabled={index === chain_order.length - 1}
                                            aria-label={`Move ${control.label} right`}
                                            onClick={() =>
                                                moveGrinderPedalInChainWithAudio(deviceId, false, pedal_type, 'right')
                                            }
                                        >
                                            Right
                                        </DawPluginChip>
                                    </Row>
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="rounded-[18px] border border-dashed border-white/10 bg-black/18 px-4 py-4 text-[13px] text-white/46">
                        Front-end chain order appears here once a supported pedal exists in the pre-amp lane.
                    </div>
                )}
            </div>
            {DRIVE_CONTROLS.map((control) => {
                const pedal = patch.prePedals.find((item) => item.type === control.type) ?? control.defaults;
                return (
                    <Stack gap={3} className="grinder-window p-3" key={control.type}>
                        <Row as="label" justify="between" gap={3}>
                            <span className="text-[11px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]">
                                {control.label}
                            </span>
                            <DawPluginToggle
                                pressed={pedal.enabled}
                                tone="amber"
                                size="sm"
                                onClick={() =>
                                    setGrinderPedalParamWithAudio(
                                        deviceId,
                                        false,
                                        control.type,
                                        'enabled',
                                        pedal.enabled ? 0 : 1,
                                        control.defaults
                                    )
                                }
                            >
                                {pedal.enabled ? 'On' : 'Off'}
                            </DawPluginToggle>
                        </Row>
                        <Row align="stretch" wrap gap={2.5}>
                            {control.params.map((param) => (
                                <Stack align="center" gap={1} key={`${control.type}-${param.key}`}>
                                    <RotaryKnob
                                        value={pedal.params[param.key] ?? param.defaultValue}
                                        onChange={(next) =>
                                            setGrinderPedalParamWithAudio(
                                                deviceId,
                                                false,
                                                control.type,
                                                param.key,
                                                next,
                                                control.defaults
                                            )
                                        }
                                        min={param.min}
                                        max={param.max}
                                        step={param.step}
                                        defaultValue={param.defaultValue}
                                        size="sm"
                                    />
                                    <span className="text-[10px] uppercase tracking-[0.22em] text-white/56">
                                        {param.label}
                                    </span>
                                    <span className="font-mono text-[10px] text-white/40">
                                        {formatValue(pedal.params[param.key] ?? param.defaultValue, param.unit)}
                                    </span>
                                </Stack>
                            ))}
                        </Row>
                    </Stack>
                );
            })}
        </div>
    );
}

function ControlDeck({
    deviceId,
    patch,
    replacePatch,
}: {
    deviceId: string;
    patch: GrinderPatch;
    replacePatch: (next: GrinderPatch) => void;
}): ReactElement {
    const neural_library_state =
        useStore(grinderNeuralLibraryStore, DEFAULT_GRINDER_NEURAL_LIBRARY_STATE) ??
        DEFAULT_GRINDER_NEURAL_LIBRARY_STATE;
    const imported_neural_entries = neural_library_state.entries ?? [];
    const visible_imported_entries =
        patch.neuralModelSource === 'imported' &&
        patch.neuralModelProfile &&
        patch.neuralModelName &&
        !imported_neural_entries.some((entry) => entry.id === patch.neuralModelId)
            ? [
                  {
                      id: patch.neuralModelId,
                      source: 'imported' as const,
                      name: patch.neuralModelName,
                      family: patch.neuralModelFamily,
                      placement: patch.neuralPlacement,
                      description: 'Selected in this patch',
                      importedAt: 0,
                      sourceFileName: null,
                      sourceFileText: null,
                      profile: patch.neuralModelProfile,
                  },
                  ...imported_neural_entries,
              ]
            : imported_neural_entries;
    const is_importing_models = neural_library_state.importing;
    let engineModeText = 'Hybrid loaded';
    if (patch.engineMode === 'circuit') {
        engineModeText = 'Circuit first';
    } else if (patch.engineMode === 'capture') {
        engineModeText = 'Capture loaded';
    }

    useEffect(() => {
        if (neural_library_state.hydrated || neural_library_state.loading) {
            return;
        }
        void restoreGrinderNeuralLibrary();
    }, [neural_library_state.hydrated, neural_library_state.loading]);

    function selectImportedNeuralModel(entry: GrinderImportedNeuralModel): void {
        replacePatch({
            ...patch,
            neuralModelId: entry.id,
            neuralModelName: entry.name,
            neuralModelFamily: entry.family,
            neuralModelSource: 'imported',
            neuralModelProfile: entry.profile,
            neuralPlacement: entry.placement,
            neuralTier: entry.profile.preferredTier,
        });
    }

    async function importNeuralModels(): Promise<void> {
        // The in-flight status is owned by importGrinderNeuralModels via the shared store,
        // so this handler stays free of component-local flag bookkeeping (and the unmount
        // hazard that came with resetting local state in an async finally).
        const imported_entries = await importGrinderNeuralModels();
        const first_entry = imported_entries[0];
        if (first_entry) {
            selectImportedNeuralModel(first_entry);
        }
    }

    async function removeImportedNeuralModel(entry: GrinderImportedNeuralModel): Promise<void> {
        await removeGrinderNeuralModel({ model_id: entry.id });
    }

    if (patch.uiSection === 'amp') {
        return (
            <Row align="stretch" wrap gap={3}>
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.gain}
                    param="gain"
                    label="Gain"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.master}
                    param="master"
                    label="Master"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.bass}
                    param="bass"
                    label="Bass"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.mid}
                    param="mid"
                    label="Mid"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.treble}
                    param="treble"
                    label="Treble"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.presence}
                    param="presence"
                    label="Presence"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.resonance}
                    param="resonance"
                    label="Resonance"
                    min={0}
                    max={10}
                    step={0.1}
                    defaultValue={5}
                />
                <Stack gap={3} className="grinder-window min-w-[220px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]">
                        Voice switches
                    </div>
                    <Row align="stretch" gap={2}>
                        {[0, 1, 2].map((channel) => (
                            <DawPluginChip
                                key={channel}
                                active={patch.channel === channel}
                                tone="amber"
                                size="sm"
                                onClick={() => setGrinderParamWithAudio(deviceId, 'channel', channel)}
                            >
                                {['Clean', 'Crunch', 'Lead'][channel]}
                            </DawPluginChip>
                        ))}
                    </Row>
                    <Row align="stretch" gap={2}>
                        {[
                            { key: 'bright', label: 'Bright', active: patch.bright },
                            { key: 'fat', label: 'Fat', active: patch.fat },
                        ].map((item) => (
                            <DawPluginToggle
                                key={item.key}
                                pressed={item.active}
                                tone="cyan"
                                size="sm"
                                onClick={() => replacePatch({ ...patch, [item.key]: !item.active })}
                            >
                                {item.label}
                            </DawPluginToggle>
                        ))}
                    </Row>
                    <Grid cols={2} gap={2}>
                        {POWER_TUBES.map((tube) => (
                            <DawPluginChip
                                key={tube}
                                active={patch.powerTubeType === tube}
                                tone="peach"
                                size="sm"
                                shape="soft"
                                className="justify-start py-2 text-left text-[11px]"
                                onClick={() => replacePatch({ ...patch, powerTubeType: tube })}
                            >
                                {tube}
                            </DawPluginChip>
                        ))}
                        {RECTIFIERS.map((rectifier) => (
                            <DawPluginChip
                                key={rectifier}
                                active={patch.rectifierType === rectifier}
                                tone="cyan"
                                size="sm"
                                shape="soft"
                                className="justify-start py-2 text-left text-[11px]"
                                onClick={() => replacePatch({ ...patch, rectifierType: rectifier })}
                            >
                                {rectifier}
                            </DawPluginChip>
                        ))}
                    </Grid>
                </Stack>
            </Row>
        );
    }

    if (patch.uiSection === 'drive') {
        return <DriveDeck deviceId={deviceId} patch={patch} />;
    }

    if (patch.uiSection === 'cab') {
        return (
            <Row align="stretch" wrap gap={3}>
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.cabResonanceFreq}
                    param="cabResonanceFreq"
                    label="Res Freq"
                    min={40}
                    max={200}
                    step={1}
                    defaultValue={80}
                    unit="Hz"
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.cabResonanceQ}
                    param="cabResonanceQ"
                    label="Res Q"
                    min={0.5}
                    max={10}
                    step={0.1}
                    defaultValue={2}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.cabDamping}
                    param="cabDamping"
                    label="Damping"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.coneBreakup}
                    param="coneBreakup"
                    label="Breakup"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.3}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.backEmf}
                    param="backEmf"
                    label="Back EMF"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.2}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.roomAmount}
                    param="roomAmount"
                    label="Room"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.1}
                />
                <Stack gap={3} className="grinder-window min-w-[210px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-cyan)]">
                        Cab toggles
                    </div>
                    <Row align="stretch" gap={2}>
                        <DawPluginToggle
                            pressed={patch.cabEnabled}
                            tone="cyan"
                            size="sm"
                            onClick={() => replacePatch({ ...patch, cabEnabled: !patch.cabEnabled })}
                        >
                            {patch.cabEnabled ? 'Cab Enabled' : 'Cab Bypassed'}
                        </DawPluginToggle>
                        <DawPluginToggle
                            pressed={patch.cabOpenBack}
                            tone="peach"
                            size="sm"
                            onClick={() => replacePatch({ ...patch, cabOpenBack: !patch.cabOpenBack })}
                        >
                            {patch.cabOpenBack ? 'Open Back' : 'Closed Back'}
                        </DawPluginToggle>
                    </Row>
                </Stack>
                <Stack gap={3} className="grinder-window min-w-[280px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-cyan)]">
                        Cab voice
                    </div>
                    <div className="grid gap-2">
                        {GRINDER_CAB_LIBRARY.map((cabinet) => (
                            <DawPluginChip
                                key={cabinet.id}
                                active={patch.cabIrId === cabinet.id}
                                tone="cyan"
                                size="sm"
                                shape="soft"
                                className="justify-start py-2 text-left text-[11px]"
                                onClick={() => replacePatch({ ...patch, cabIrId: cabinet.id })}
                            >
                                {cabinet.label}
                            </DawPluginChip>
                        ))}
                    </div>
                </Stack>
                <Stack gap={3} className="grinder-window min-w-[260px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]">
                        Cab mode
                    </div>
                    <div className="grid gap-2">
                        {CAB_MODES.map((mode) => (
                            <DawPluginChip
                                key={mode.id}
                                active={patch.cabType === mode.id}
                                tone="amber"
                                size="sm"
                                shape="soft"
                                className="justify-start py-2 text-left text-[11px]"
                                onClick={() => replacePatch({ ...patch, cabType: mode.id })}
                            >
                                {mode.label}
                            </DawPluginChip>
                        ))}
                    </div>
                </Stack>
                <Stack gap={3} className="grinder-window min-w-[280px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-peach)]">
                        Routing preset
                    </div>
                    <div className="grid gap-2">
                        {ROUTING_PRESETS.map((preset) => (
                            <DawPluginChip
                                key={preset.id}
                                active={patch.routingMode === preset.id}
                                tone="peach"
                                size="sm"
                                shape="soft"
                                className="justify-start py-2 text-left text-[11px]"
                                onClick={() => replacePatch({ ...patch, routingMode: preset.id })}
                            >
                                {preset.label}
                            </DawPluginChip>
                        ))}
                    </div>
                </Stack>
            </Row>
        );
    }

    if (patch.uiSection === 'neural') {
        return (
            <Row align="stretch" wrap gap={3}>
                <Stack gap={3} className="grinder-window min-w-[280px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-lavender)]">
                        Engine Mode
                    </div>
                    <Grid cols={3} gap={2}>
                        {ENGINE_MODES.map((mode) => (
                            <Button
                                variant="bare"
                                size="bare"
                                key={mode.id}
                                type="button"
                                className={`rounded-[16px] border px-3 py-3 text-left ${
                                    patch.engineMode === mode.id
                                        ? 'border-[var(--color-accent-lavender)]/60 bg-[var(--color-accent-lavender)]/12'
                                        : 'border-white/8 bg-black/20'
                                }`}
                                onClick={() =>
                                    replacePatch({
                                        ...patch,
                                        engineMode: mode.id,
                                        neuralEnabled: mode.id !== 'circuit',
                                    })
                                }
                            >
                                <div className="text-sm font-medium text-white/88">{mode.label}</div>
                                <div className="text-xs text-white/44">{mode.description}</div>
                            </Button>
                        ))}
                    </Grid>
                </Stack>
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.neuralMix}
                    param="neuralMix"
                    label="Blend"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={1}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.neuralCpuBudget}
                    param="neuralCpuBudget"
                    label="CPU"
                    min={0}
                    max={2}
                    step={1}
                    defaultValue={1}
                />
                <Stack gap={3} className="grinder-window min-w-[220px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-cyan)]">
                        Capture Role
                    </div>
                    <div className="grid gap-2">
                        {[
                            { id: 'amp-capture', label: 'Amp capture' },
                            { id: 'rig-capture', label: 'Rig capture' },
                        ].map((placement) => (
                            <Button
                                variant="bare"
                                size="bare"
                                key={placement.id}
                                type="button"
                                className={`rounded-[14px] border px-3 py-2 text-left text-sm ${
                                    patch.neuralPlacement === placement.id
                                        ? 'border-[var(--color-accent-cyan)]/60 bg-[var(--color-accent-cyan)]/10 text-[var(--color-accent-cyan)]'
                                        : 'border-white/8 bg-black/20 text-white/52'
                                }`}
                                onClick={() =>
                                    replacePatch({
                                        ...patch,
                                        neuralPlacement: placement.id as GrinderPatch['neuralPlacement'],
                                    })
                                }
                            >
                                {placement.label}
                            </Button>
                        ))}
                    </div>
                    <div className="text-xs text-white/44">
                        <NeuralTelemetryReadout deviceId={deviceId} />
                    </div>
                </Stack>
                <Stack grow gap={3} className="grinder-window min-w-[320px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]">
                        Factory Voices
                    </div>
                    <div className="grid gap-2">
                        {GRINDER_NEURAL_LIBRARY.map((model) => {
                            const selected = patch.neuralModelId === model.id;
                            return (
                                <Button
                                    variant="bare"
                                    size="bare"
                                    key={model.id}
                                    type="button"
                                    className={`rounded-[18px] border px-4 py-3 text-left ${
                                        selected
                                            ? 'border-[var(--color-accent-amber)]/60 bg-[var(--color-accent-amber)]/12'
                                            : 'border-white/8 bg-black/20'
                                    }`}
                                    onClick={() =>
                                        replacePatch({
                                            ...patch,
                                            neuralModelId: model.id,
                                            neuralModelName: model.name,
                                            neuralModelFamily: model.family,
                                            neuralModelSource: 'builtin',
                                            neuralModelProfile: null,
                                            neuralPlacement: model.placement,
                                            neuralTier: 'standard',
                                        })
                                    }
                                >
                                    <Row justify="between">
                                        <span className="text-sm font-medium text-white/88">{model.name}</span>
                                        <span className="text-[10px] uppercase tracking-[0.18em] text-white/34">
                                            {model.family}
                                        </span>
                                    </Row>
                                    <div className="mt-1 text-xs text-white/44">{model.description}</div>
                                </Button>
                            );
                        })}
                    </div>
                </Stack>
                <Stack grow gap={3} className="grinder-window min-w-[320px] px-3 py-3">
                    <Row justify="between" gap={3}>
                        <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-cyan)]">
                            Imported captures
                        </div>
                        <Button
                            variant="bare"
                            size="bare"
                            type="button"
                            className="rounded-[14px] border border-[var(--color-accent-cyan)]/30 bg-[var(--color-accent-cyan)]/10 px-3 py-1 text-[11px] font-medium text-[var(--color-accent-cyan)]"
                            onClick={() => void importNeuralModels()}
                            disabled={is_importing_models}
                        >
                            {is_importing_models ? 'Importing…' : 'Import NAM'}
                        </Button>
                    </Row>
                    {neural_library_state.error ? (
                        <div className="rounded-[14px] border border-red-400/30 bg-red-400/8 px-3 py-2 text-xs text-red-200">
                            {neural_library_state.error}
                        </div>
                    ) : null}
                    {visible_imported_entries.length === 0 ? (
                        <div className="rounded-[16px] border border-white/8 bg-black/20 px-4 py-4 text-sm text-white/44">
                            Import one or more documented `.nam` captures to build a reusable Neural library.
                        </div>
                    ) : (
                        <div className="grid gap-2">
                            {visible_imported_entries.map((entry) => {
                                const selected = patch.neuralModelId === entry.id;
                                return (
                                    <ImportedNeuralLibraryCard
                                        key={entry.id}
                                        entry={entry}
                                        selected={selected}
                                        on_select={selectImportedNeuralModel}
                                        on_export={exportGrinderNeuralModel}
                                        on_remove={(value) => void removeImportedNeuralModel(value)}
                                    />
                                );
                            })}
                        </div>
                    )}
                </Stack>
            </Row>
        );
    }

    if (patch.uiSection === 'lab') {
        return (
            <Row align="stretch" wrap gap={3}>
                <Stack gap={3} className="grinder-window min-w-[220px] px-3 py-3">
                    <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-cyan)]">Gate</div>
                    <DawPluginToggle
                        pressed={patch.gateEnabled}
                        tone="cyan"
                        size="sm"
                        onClick={() => setGrinderParamWithAudio(deviceId, 'gateEnabled', patch.gateEnabled ? 0 : 1)}
                    >
                        {patch.gateEnabled ? 'Gate On' : 'Gate Off'}
                    </DawPluginToggle>
                    <div className="text-xs text-white/44">
                        Enable the gate before dialing threshold, attack, or release.
                    </div>
                </Stack>
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.gateThreshold}
                    param="gateThreshold"
                    label="Gate"
                    min={-80}
                    max={0}
                    step={1}
                    defaultValue={-60}
                    unit="dB"
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.gateAttack}
                    param="gateAttack"
                    label="G Atk"
                    min={0.1}
                    max={50}
                    step={0.1}
                    defaultValue={2}
                    unit="ms"
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.gateRelease}
                    param="gateRelease"
                    label="G Rel"
                    min={5}
                    max={500}
                    step={1}
                    defaultValue={120}
                    unit="ms"
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.sagAmount}
                    param="sagAmount"
                    label="Sag"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.4}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.sagRecovery}
                    param="sagRecovery"
                    label="Recovery"
                    min={10}
                    max={2000}
                    step={10}
                    defaultValue={200}
                    unit="ms"
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.negFeedback}
                    param="negFeedback"
                    label="NFB"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.transformerDrive}
                    param="transformerDrive"
                    label="Drive"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.3}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.transformerHysteresis}
                    param="transformerHysteresis"
                    label="Hyst"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.3}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.transformerLfSaturation}
                    param="transformerLfSaturation"
                    label="LF Sat"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.3}
                />
                <GrinderKnob
                    deviceId={deviceId}
                    value={patch.tubeBias}
                    param="tubeBias"
                    label="Bias"
                    min={0}
                    max={1}
                    step={0.01}
                    defaultValue={0.5}
                />
            </Row>
        );
    }

    return (
        <Row align="stretch" wrap gap={3}>
            <Stack gap={2} className="grinder-window min-w-[250px] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-amber)]">
                    Current preset
                </div>
                <div className="text-xl font-semibold text-white/90">{patch.name}</div>
                <div className="text-sm text-white/46">{engineModeText}</div>
            </Stack>
            <Stack gap={2} className="grinder-window min-w-[200px] px-3 py-3">
                <div className="text-[10px] uppercase tracking-[0.24em] text-[var(--color-accent-cyan)]">
                    Quick read
                </div>
                <QuickTelemetryReadout deviceId={deviceId} />
            </Stack>
        </Row>
    );
}

function HeroStage({ deviceId, patch }: { deviceId: string; patch: GrinderPatch }): ReactElement {
    if (patch.uiSection === 'amp') {
        return <ToneResponseStage deviceId={deviceId} patch={patch} />;
    }
    if (patch.uiSection === 'drive') {
        return <DriveStage patch={patch} />;
    }
    if (patch.uiSection === 'cab') {
        return <CabStage deviceId={deviceId} patch={patch} />;
    }
    if (patch.uiSection === 'neural') {
        return <NeuralStage deviceId={deviceId} patch={patch} />;
    }
    if (patch.uiSection === 'lab') {
        return <LabStage deviceId={deviceId} patch={patch} />;
    }

    const activeAmp = AMP_MODELS.find((amp) => amp.id === patch.ampModel);

    let heroEngineText = 'Circuit';
    if (patch.engineMode === 'capture') {
        heroEngineText = 'Capture';
    } else if (patch.engineMode === 'hybrid') {
        heroEngineText = 'Hybrid';
    }

    return (
        <div className="grid h-full grid-cols-[1.02fr_0.98fr] gap-3">
            <Stack gap={3} className="grinder-window p-3">
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]">
                    Current preset
                </div>
                <div className="text-[26px] font-semibold text-white/92">{patch.name}</div>
                <div className="max-w-[36rem] text-[14px] leading-6 text-white/54">
                    This is the loaded rig view. Grab a preset on the left, then hop into Amp, Drive, Cab, Neural, or
                    Lab when you want to get more specific.
                </div>
                <Grid cols={3} gap={2}>
                    <GrinderTelemetryMeter
                        deviceId={deviceId}
                        label="Input"
                        telemetryKey="inputDb"
                        accent="var(--color-accent-cyan)"
                        transform={toDbPercent}
                    />
                    <GrinderTelemetryMeter
                        deviceId={deviceId}
                        label="Gate"
                        telemetryKey="gateOpen"
                        accent="var(--color-accent-amber)"
                    />
                    <GrinderTelemetryMeter
                        deviceId={deviceId}
                        label="Output"
                        telemetryKey="outputDb"
                        accent="var(--color-accent-peach)"
                        transform={toDbPercent}
                    />
                </Grid>
            </Stack>
            <Stack gap={3} className="grinder-window p-3">
                <div className="text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-cyan)]">
                    Loaded rig
                </div>
                <div className="text-lg font-semibold text-white/90">{activeAmp?.label ?? 'Custom amp'}</div>
                <Stack gap={2.5} className="text-[13px] text-white/56">
                    <div>Engine: {heroEngineText}.</div>
                    <div>
                        Gate: {patch.gateEnabled ? 'enabled' : 'off'} · Cab: {patch.cabEnabled ? 'on' : 'off'} · Neural:{' '}
                        {patch.neuralEnabled ? 'on' : 'off'}.
                    </div>
                    <div>Front-end pedals: {patch.prePedals.filter((pedal) => pedal.enabled).length} active.</div>
                </Stack>
            </Stack>
        </div>
    );
}

function StatusStrip({ deviceId }: { deviceId: string }): ReactElement {
    return (
        <div className="grid gap-2 md:grid-cols-4 xl:grid-cols-8">
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Input"
                telemetryKey="inputDb"
                accent="var(--color-accent-cyan)"
                transform={toDbPercent}
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Pre"
                telemetryKey="preampDb"
                accent="var(--color-accent-amber)"
                transform={toDbPercent}
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Power"
                telemetryKey="powerAmpDb"
                accent="var(--color-accent-peach)"
                transform={toDbPercent}
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Out"
                telemetryKey="outputDb"
                accent="var(--color-accent-orange)"
                transform={toDbPercent}
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Gate"
                telemetryKey="gateOpen"
                accent="var(--color-accent-cyan)"
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Sag"
                telemetryKey="sagVoltage"
                accent="var(--color-accent-orange)"
                transform={(value) => Math.max(0, Math.min(1, value))}
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="Warm"
                telemetryKey="neuralWarmupProgress"
                accent="var(--color-accent-lavender)"
            />
            <GrinderTelemetryMeter
                deviceId={deviceId}
                label="CPU"
                telemetryKey="neuralCpuPercent"
                accent="var(--color-accent-lavender)"
                transform={(value) => value / 100}
            />
        </div>
    );
}

export const GrinderPanel = ({ deviceId }: { deviceId: string }): ReactElement => {
    const allInstances = useStore(grinderStore, {});
    const projectParameterValues = useStoreSelector(trackStore, (state) =>
        selectProjectParameterValues(state, deviceId)
    );
    const state: GrinderState = allInstances?.[deviceId] ?? getGrinderState(deviceId);
    const patch = state.patch;

    useEffect(() => {
        if (projectParameterValues) {
            hydrateGrinderPatchFromProject(deviceId);
        }
    }, [deviceId, projectParameterValues]);

    function replacePatch(next: GrinderPatch): void {
        loadGrinderPatchWithAudio(deviceId, next);
    }

    return (
        <Stack className="grinder-faceplate h-full overflow-hidden p-3">
            <Row align="stretch" grow gap={3} className="min-h-0 overflow-hidden">
                <BrowserRail deviceId={deviceId} patch={patch} replacePatch={replacePatch} />
                <Stack as="section" grow gap={3} className="overflow-y-auto pr-1">
                    <SectionTabs deviceId={deviceId} patch={patch} />
                    <div className="min-h-[280px] shrink-0 overflow-hidden">
                        <HeroStage deviceId={deviceId} patch={patch} />
                    </div>
                    <div className="shrink-0 rounded-[24px] border border-white/8 bg-[linear-gradient(180deg,rgba(255,255,255,0.032),rgba(255,255,255,0.012))] p-3 shadow-[var(--shadow-elevation-raised)]">
                        <div className="mb-2 text-[10px] uppercase tracking-[0.28em] text-[var(--color-accent-amber)]">
                            Control deck
                        </div>
                        <ControlDeck deviceId={deviceId} patch={patch} replacePatch={replacePatch} />
                    </div>
                </Stack>
            </Row>
            <div className="mt-3">
                <StatusStrip deviceId={deviceId} />
            </div>
        </Stack>
    );
};
