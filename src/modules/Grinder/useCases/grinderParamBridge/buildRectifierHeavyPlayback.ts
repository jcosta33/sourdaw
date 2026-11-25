import { type applyRuntimeGrinderPreset } from '#/modules/AudioEngine/useCases';

import { type GrinderFactoryPresetAction } from '../../events/grinderAppActions';
import { DEFAULT_PATCH } from '../../models/GrinderPatch';
import { applyGrinderProjectParameters } from '../../models/GrinderProjectParameterMap';
import { grinderNeuralLibraryStore } from '../../stores/grinderNeuralLibraryStore';
import { readGrinderNeuralModelContent } from '../../stores/readGrinderNeuralModelContent';

import { encodeGrinderPatchCommands } from './encodeGrinderPatchCommands';
import { type GrinderNeuralAudioPatch } from './helpers';

type Payload = GrinderFactoryPresetAction['payload'];
type Playback = Parameters<typeof applyRuntimeGrinderPreset>[0];
type PresetParameter = Playback['web']['parameters'][number];

// The DSP constructor holds several neutral values that differ from the knob
// and factory-patch defaults. Explicit project values still use their own law.
const CONSTRUCTOR_PARAMETERS: Readonly<Partial<Record<string, number>>> = {
    mic2PositionY: 0.3,
    mic2Distance: 0.5,
    preCompressorThreshold: -20,
    preCompressorRatio: 4,
    preCompressorAttack: 10,
    preCompressorRelease: 200,
    preOverdriveDrive: 4.5,
    preOverdriveTone: 5.5,
    preOverdriveLevel: 6,
    preDistortionDrive: 5,
    preDistortionTone: 5,
    preDistortionLevel: 5.8,
    preFuzzLevel: 6.2,
    postCompressorThreshold: -20,
    postCompressorRatio: 4,
    postCompressorAttack: 10,
    postCompressorRelease: 200,
    postOverdriveDrive: 4.5,
    postOverdriveTone: 5.5,
    postOverdriveLevel: 6,
    postDistortionDrive: 5,
    postDistortionTone: 5,
    postDistortionLevel: 5.8,
    postFuzzLevel: 6.2,
};
const CONSTRUCTOR_RESETS = [
    'gateAttack',
    'gateRelease',
    'couplingCapCharge',
    'transformerDrive',
    'transformerHysteresis',
    'transformerLfSaturation',
] as const;

function isModelDependency(parameterId: string, neural: GrinderNeuralAudioPatch): boolean {
    if (neural.neuralModelMode === 'builtin') {
        return parameterId === 'neuralModelSlot';
    }
    return parameterId.startsWith('neuralCustom') && !parameterId.startsWith('neuralCustomModelDigest');
}

function readPresetParameters(
    payload: Payload,
    values: Readonly<Record<string, number>>,
    encoded: readonly PresetParameter[],
    neural: GrinderNeuralAudioPatch
): PresetParameter[] {
    const footprint = payload.direction === 'undo' ? payload.before : payload.after;
    const defaults = new Map(encoded.map(({ parameterId, value }) => [parameterId, value]));
    const result: PresetParameter[] = [];
    for (const [parameterId, captured] of Object.entries(footprint)) {
        const value = constructorOrProjectValue(parameterId, captured, values, defaults);
        if (value === undefined) {
            throw new Error(`Grinder preset lacks a runtime value for ${parameterId}`);
        }
        result.push({ parameterId, value });
    }
    if (payload.direction === 'undo') {
        result.push(
            ...encoded.filter(
                ({ parameterId }) => isModelDependency(parameterId, neural) && !Object.hasOwn(footprint, parameterId)
            )
        );
    }
    return result;
}

function constructorOrProjectValue(
    parameterId: string,
    captured: number | null,
    values: Readonly<Record<string, number>>,
    defaults: ReadonlyMap<string, number>
): number | undefined {
    if (captured !== null) {
        return values[parameterId];
    }
    return CONSTRUCTOR_PARAMETERS[parameterId] ?? defaults.get(parameterId);
}

function nativeValues(
    parameters: readonly PresetParameter[],
    effective: ReadonlyMap<string, number>,
    resets: ReadonlySet<string>
): Record<string, number> {
    const values: Record<string, number> = {};
    const early = parameters.find(({ parameterId }) => parameterId === 'neuralEnabled');
    if (early) {
        values.neuralEnabled = effective.get(early.parameterId) ?? early.value;
    }
    const delayed = new Map<string, number>();
    for (const { parameterId, value } of parameters) {
        if (resets.has(parameterId)) {
            continue;
        }
        const target = effective.get(parameterId) ?? value;
        if (parameterId === 'neuralModelMode' || parameterId === 'neuralModelSlot') {
            delayed.set(parameterId, target);
        } else {
            values[parameterId] = target;
        }
    }
    return Object.assign(values, Object.fromEntries(delayed));
}

export function buildRectifierHeavyPlayback(
    payload: Payload,
    values: Readonly<Record<string, number>>,
    readEffectiveValue: (trackId: string, deviceId: string, parameterId: string) => number | undefined
): Playback {
    const { trackId, deviceId } = payload;
    const library = grinderNeuralLibraryStore.value?.entries ?? [];
    const patch = applyGrinderProjectParameters(DEFAULT_PATCH, values, library);
    const commands = encodeGrinderPatchCommands(patch);
    const patchCommand = commands.find((command) => command.kind === 'neural');
    if (!patchCommand) {
        throw new Error('Grinder preset lacks a model command');
    }
    const modelJson = readGrinderNeuralModelContent(values);
    const neural = modelJson === undefined ? patchCommand.patch : { ...patchCommand.patch, modelJson };
    const encoded = commands.flatMap((command) =>
        command.kind === 'parameter' ? [{ parameterId: command.key, value: command.value }] : []
    );
    const parameters = readPresetParameters(payload, values, encoded, neural);
    const overrides = parameters.flatMap(({ parameterId }) => {
        const value = readEffectiveValue(trackId, deviceId, parameterId);
        return value === undefined || !Number.isFinite(value) ? [] : [{ parameterId, value }];
    });
    const effective = new Map(overrides.map(({ parameterId, value }) => [parameterId, value]));
    let resetParameterIds: readonly string[] = [];
    if (payload.direction === 'undo') {
        resetParameterIds = CONSTRUCTOR_RESETS.filter((id) => payload.before[id] === null && !effective.has(id));
    }
    return {
        trackId,
        deviceId,
        web: {
            parameters,
            overrides,
            neural,
            resetParameterIds: resetParameterIds.filter((id) => id !== 'transformerDrive'),
        },
        native: {
            values: nativeValues(parameters, effective, new Set(resetParameterIds)),
            modelJson: modelJson ?? null,
            resetParameterIds,
        },
    };
}
