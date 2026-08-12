import {
    DEFAULT_PATCH,
    GRINDER_CAB_LIBRARY,
    GRINDER_NEURAL_LIBRARY,
    SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES,
    type GrinderMic,
    type GrinderPatch,
    type GrinderPedal,
} from './GrinderPatch';

const INDEXED_VALUES: Partial<Record<keyof GrinderPatch, readonly string[]>> = {
    engineMode: ['circuit', 'capture', 'hybrid'],
    inputMode: ['instrument', 'line', 'reamp'],
    ampModel: ['clean-twin', 'crunch-jcm', 'lead-jcm', 'ac30-tb', 'rectifier', 'custom'],
    toneStackType: ['fender', 'marshall', 'vox'],
    powerTubeType: ['6l6', 'el34', 'el84'],
    rectifierType: ['tube', 'solid-state', 'variac'],
    cabType: ['ir', 'parametric', 'both'],
    neuralPlacement: ['amp-capture', 'rig-capture'],
    neuralTier: ['standard', 'lite', 'nano', 'recurrent'],
    routingMode: ['serial', 'parallel', 'wet-dry-wet', 'dual-amp'],
};
export const GRINDER_PROJECT_PARAM_KEYS = (Object.keys(DEFAULT_PATCH) as Array<keyof GrinderPatch>).filter((key) => {
    const value = DEFAULT_PATCH[key];
    return (
        !['neuralWarmupProgress', 'activeSnapshot'].includes(key) &&
        (typeof value === 'number' || typeof value === 'boolean' || INDEXED_VALUES[key] !== undefined)
    );
});
const MIC_TYPES: readonly GrinderMic['type'][] = ['dynamic', 'ribbon', 'condenser', 'room'];
const PEDAL_DEFAULTS = {
    compressor: { id: 'comp1', params: { threshold: -24, ratio: 3, attack: 16, release: 220 } },
    overdrive: { id: 'od1', params: { drive: 2.8, tone: 5.2, level: 5.4 } },
    distortion: { id: 'dist1', params: { drive: 5.2, tone: 4.4, level: 7.2 } },
    fuzz: { id: 'fuzz1', params: { fuzz: 6.8, tone: 4.8, level: 6.4 } },
} as const;
const PROJECT_PEDAL_TYPES = new Set(['compressor', 'overdrive', 'boost', 'distortion', 'fuzz']);
function readNumber(values: Readonly<Record<string, unknown>>, key: string, fallback: number): number {
    const raw = values[key];
    return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}
function decodeProjectValue(key: keyof GrinderPatch, raw: number): unknown {
    if (typeof DEFAULT_PATCH[key] === 'boolean') {
        return raw > 0.5;
    }
    if (key === 'channel') {
        return Math.trunc(raw);
    }
    if (key === 'neuralCpuBudget') {
        return Math.round(raw);
    }
    const options = INDEXED_VALUES[key];
    if (options) {
        const normalized = key === 'cabType' || key === 'routingMode' ? Math.round(raw) : Math.trunc(raw);
        const index = Math.max(0, Math.min(options.length - 1, normalized));
        return options[index] ?? options[0] ?? '';
    }
    return raw;
}
function projectMic(micIndex: 1 | 2, parameterValues: Readonly<Record<string, unknown>>): GrinderMic {
    const fallback = micIndex === 1 ? DEFAULT_PATCH.mic1 : DEFAULT_PATCH.mic2;
    const prefix = `mic${micIndex}`;
    const typeIndex = Math.trunc(readNumber(parameterValues, `${prefix}Type`, MIC_TYPES.indexOf(fallback.type)));
    return {
        type: MIC_TYPES[Math.max(0, Math.min(MIC_TYPES.length - 1, typeIndex))] ?? fallback.type,
        positionX: readNumber(parameterValues, `${prefix}PositionX`, fallback.positionX),
        positionY: readNumber(parameterValues, `${prefix}PositionY`, fallback.positionY),
        distance: readNumber(parameterValues, `${prefix}Distance`, fallback.distance),
        gain: readNumber(parameterValues, `${prefix}Gain`, fallback.gain),
        enabled: readNumber(parameterValues, `${prefix}Enabled`, fallback.enabled ? 1 : 0) > 0.5,
    };
}
function pedalLabel(type: string): string {
    return type.charAt(0).toUpperCase() + type.slice(1);
}
function pedalOrder(pedal: GrinderPedal, prefix: string, parameterValues: Readonly<Record<string, unknown>>): number {
    const type = pedal.type === 'boost' ? 'overdrive' : pedal.type;
    return readNumber(parameterValues, `${prefix}${pedalLabel(type)}Order`, 0);
}
function projectPedals(
    current: readonly GrinderPedal[],
    isPost: boolean,
    parameterValues: Readonly<Record<string, unknown>>
): GrinderPedal[] {
    const prefix = isPost ? 'post' : 'pre';
    const retained = current.filter((pedal) => !PROJECT_PEDAL_TYPES.has(pedal.type));
    const projected: GrinderPedal[] = SUPPORTED_GRINDER_CHAIN_PEDAL_TYPES.flatMap((type) => {
        const label = `${prefix}${pedalLabel(type)}`;
        const defaults = PEDAL_DEFAULTS[type].params;
        const existing = current.find(
            (pedal) => pedal.type === type || (type === 'overdrive' && pedal.type === 'boost')
        );
        const enabled = readNumber(parameterValues, `${label}Enabled`, 0) > 0.5;
        const params = Object.fromEntries(
            Object.entries(defaults).map(([key, fallback]) => [
                key,
                readNumber(parameterValues, `${label}${key.charAt(0).toUpperCase()}${key.slice(1)}`, fallback),
            ])
        );
        const order = readNumber(parameterValues, `${label}Order`, -1);
        const changed = Object.entries(defaults).some(([key, fallback]) => params[key] !== fallback);
        if (order < 0 && !enabled && !changed) {
            return [];
        }
        return [
            {
                id: existing?.id ?? PEDAL_DEFAULTS[type].id,
                type: existing?.type === 'boost' ? 'boost' : type,
                enabled,
                params,
            },
        ];
    });
    projected.sort(
        (left, right) => pedalOrder(left, prefix, parameterValues) - pedalOrder(right, prefix, parameterValues)
    );
    return [...retained, ...projected];
}
export function applyGrinderProjectParameters(
    patch: GrinderPatch,
    parameterValues: Readonly<Record<string, unknown>>
): GrinderPatch {
    const cabSlot = Math.round(readNumber(parameterValues, 'cabIrSlot', 0));
    const neuralSlot = Math.round(readNumber(parameterValues, 'neuralModelSlot', -1));
    const importedModel =
        readNumber(parameterValues, 'neuralModelMode', Number(patch.neuralModelSource === 'imported')) > 0.5;
    const neuralModel = importedModel ? undefined : GRINDER_NEURAL_LIBRARY[neuralSlot];
    const next: GrinderPatch = {
        ...patch,
        cabIrId: GRINDER_CAB_LIBRARY[cabSlot]?.id ?? DEFAULT_PATCH.cabIrId,
        mic1: projectMic(1, parameterValues),
        mic2: projectMic(2, parameterValues),
        prePedals: projectPedals(patch.prePedals, false, parameterValues),
        postPedals: projectPedals(patch.postPedals, true, parameterValues),
    };
    if (neuralModel) {
        next.neuralModelId = neuralModel.id;
        next.neuralModelName = neuralModel.name;
        next.neuralModelFamily = neuralModel.family;
        Object.assign(next, { neuralModelSource: 'builtin', neuralModelProfile: null });
    }
    for (const key of GRINDER_PROJECT_PARAM_KEYS) {
        const raw = parameterValues[key];
        let value: unknown = DEFAULT_PATCH[key];
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            value = decodeProjectValue(key, raw);
        }
        Object.assign(next, { [key]: value });
    }
    return next;
}
