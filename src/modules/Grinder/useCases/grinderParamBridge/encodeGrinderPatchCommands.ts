import { grinderNeuralModelJson } from '../../models/GrinderNeuralModelJson';
import { grinderNeuralProfileParams } from '../../models/GrinderNeuralProfileParams';
import { type GrinderPatch, type GrinderPedal } from '../../models/GrinderPatch';
import { GRINDER_PROJECT_PARAM_KEYS } from '../../models/GrinderProjectParameterMap';

import { getCabIrSlot } from './getCabIrSlot';
import { getNeuralModelSlot } from './getNeuralModelSlot';
import { getPedalOrderAudioEntries } from './getPedalOrderAudioEntries';
import {
    AMP_MODELS,
    CAB_TYPES,
    ENGINE_MODES,
    type GrinderNeuralAudioPatch,
    INPUT_MODES,
    NEURAL_PLACEMENTS,
    NEURAL_TIERS,
    POWER_TUBE_TYPES,
    RECTIFIER_TYPES,
    ROUTING_MODES,
    TONE_STACK_TYPES,
    DEFAULT_GRINDER_PEDAL_PARAMS,
} from './helpers';

type GrinderPatchCommand =
    { kind: 'parameter'; key: string; value: number } | { kind: 'neural'; patch: GrinderNeuralAudioPatch };

const ENUM_OPTIONS: Partial<Record<keyof GrinderPatch, readonly string[]>> = {
    engineMode: ENGINE_MODES,
    ampModel: AMP_MODELS,
    inputMode: INPUT_MODES,
    toneStackType: TONE_STACK_TYPES,
    powerTubeType: POWER_TUBE_TYPES,
    rectifierType: RECTIFIER_TYPES,
    cabType: CAB_TYPES,
    neuralPlacement: NEURAL_PLACEMENTS,
    neuralTier: NEURAL_TIERS,
    routingMode: ROUTING_MODES,
};

function toAudioValue<TKey extends keyof GrinderPatch>(key: TKey, value: GrinderPatch[TKey]): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }
    const options = ENUM_OPTIONS[key];
    if (typeof value !== 'string' || !options) {
        return null;
    }
    const index = options.indexOf(value);
    return index >= 0 ? index : null;
}

function findFirstPedal(pedals: readonly GrinderPedal[], types: readonly string[]): GrinderPedal | undefined {
    return pedals.find((pedal) => types.includes(pedal.type));
}

// The engine exposes a single overdrive-family slot (getAudioParamKeyForPedal maps both
// 'overdrive' and 'boost' onto the 'Overdrive' params), so the two pedal types contend
// for it. Selection is deterministic by pedal identity rather than chain array order:
// an enabled pedal always outranks a bypassed one (never silently drop the pedal the user
// turned on), and within the same enabled-state the native 'overdrive' outranks the
// 'boost' that borrows the slot. A patch carrying both pedals therefore drives the slot
// the same way regardless of how the chain is ordered.
const OVERDRIVE_FAMILY_TYPES: readonly string[] = ['overdrive', 'boost'];

function selectOverdriveFamilyPedal(pedals: readonly GrinderPedal[]): GrinderPedal | undefined {
    let selected: GrinderPedal | undefined;
    let selectedRank = Number.POSITIVE_INFINITY;
    for (const pedal of pedals) {
        const typeRank = OVERDRIVE_FAMILY_TYPES.indexOf(pedal.type);
        if (typeRank < 0) {
            continue;
        }

        // Lower rank wins. Enabled pedals occupy ranks 0–1, bypassed ones 2–3; within each
        // band the native 'overdrive' (typeRank 0) precedes the 'boost' (typeRank 1).
        // Strict comparison keeps the first pedal among equal ranks, so chain order only
        // breaks exact ties.
        const rank = (pedal.enabled ? 0 : 2) + typeRank;
        if (rank < selectedRank) {
            selected = pedal;
            selectedRank = rank;
        }
    }

    return selected;
}

type AddParameter = (key: string, value: number) => void;

function addPedalParameters(
    addParameter: AddParameter,
    position: 'pre' | 'post',
    pedals: readonly GrinderPedal[]
): void {
    const selected = {
        compressor: findFirstPedal(pedals, ['compressor']),
        overdrive: selectOverdriveFamilyPedal(pedals),
        distortion: findFirstPedal(pedals, ['distortion']),
        fuzz: findFirstPedal(pedals, ['fuzz']),
    };
    for (const type of ['compressor', 'overdrive', 'distortion', 'fuzz'] as const) {
        const pedal = selected[type];
        const prefix = `${position}${type.charAt(0).toUpperCase()}${type.slice(1)}`;
        addParameter(`${prefix}Enabled`, pedal?.enabled ? 1 : 0);
        for (const [key, fallback] of Object.entries(DEFAULT_GRINDER_PEDAL_PARAMS[type])) {
            const suffix = `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
            addParameter(`${prefix}${suffix}`, pedal?.params[key] ?? fallback);
        }
    }
}

function addNeuralCommands(commands: GrinderPatchCommand[], addParameter: AddParameter, patch: GrinderPatch): void {
    const importedModel = patch.neuralModelSource === 'imported' && patch.neuralModelProfile;
    // The numeric writes below are what the native door and the persisted
    // record carry; the structured patch further down is the worklet's own
    // protocol for the same profile.
    if (importedModel) {
        for (const [key, value] of grinderNeuralProfileParams(importedModel)) {
            addParameter(key, value);
        }
    }
    addParameter('neuralModelMode', importedModel ? 1 : 0);
    if (importedModel) {
        // The model rides the structured patch as `.nam` JSON (#3774): the
        // worklet parses it into the real network. A profile without a model
        // — a record no library entry claims — sends none and the scalar
        // substitute runs, the same degradation #4146 established.
        const patch: GrinderNeuralAudioPatch = {
            neuralModelMode: 'imported',
            profile: importedModel,
        };
        if (importedModel.model) {
            patch.modelJson = grinderNeuralModelJson(importedModel.model);
        }
        commands.push({ kind: 'neural', patch });
    } else {
        commands.push({ kind: 'neural', patch: { neuralModelMode: 'builtin' } });
        const neural_model_slot = getNeuralModelSlot(patch.neuralModelId);
        if (neural_model_slot !== null) {
            addParameter('neuralModelSlot', neural_model_slot);
        }
    }
}

export function encodeGrinderPatchCommands(patch: GrinderPatch): GrinderPatchCommand[] {
    const commands: GrinderPatchCommand[] = [];
    function addParameter(key: string, value: number): void {
        if (Number.isFinite(value)) {
            commands.push({ kind: 'parameter', key, value });
        }
    }

    const cab_ir_slot = getCabIrSlot(patch.cabIrId);

    if (cab_ir_slot !== null) {
        addParameter('cabIrSlot', cab_ir_slot);
    }

    for (const key of GRINDER_PROJECT_PARAM_KEYS) {
        const value = toAudioValue(key, patch[key]);
        if (value === null) {
            continue;
        }

        addParameter(key, value);
    }

    addPedalParameters(addParameter, 'pre', patch.prePedals);
    addPedalParameters(addParameter, 'post', patch.postPedals);

    for (const entry of getPedalOrderAudioEntries(false, patch.prePedals)) {
        addParameter(entry.key, entry.value);
    }

    for (const entry of getPedalOrderAudioEntries(true, patch.postPedals)) {
        addParameter(entry.key, entry.value);
    }

    addNeuralCommands(commands, addParameter, patch);

    addParameter('mic1Enabled', patch.mic1.enabled ? 1 : 0);
    addParameter('mic1PositionX', patch.mic1.positionX);
    addParameter('mic1PositionY', patch.mic1.positionY);
    addParameter('mic1Distance', patch.mic1.distance);
    addParameter('mic1Gain', patch.mic1.gain);
    addParameter('mic2Enabled', patch.mic2.enabled ? 1 : 0);
    addParameter('mic2PositionX', patch.mic2.positionX);
    addParameter('mic2PositionY', patch.mic2.positionY);
    addParameter('mic2Distance', patch.mic2.distance);
    addParameter('mic2Gain', patch.mic2.gain);
    return commands;
}
