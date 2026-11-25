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

function getOptionIndex<TOptions extends readonly string[]>(options: TOptions, value: string): number | null {
    const index = options.indexOf(value);
    return index >= 0 ? index : null;
}

function toAudioValue<TKey extends keyof GrinderPatch>(key: TKey, value: GrinderPatch[TKey]): number | null {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    switch (key) {
        case 'engineMode':
            return getOptionIndex(ENGINE_MODES, value as string);
        case 'ampModel':
            return getOptionIndex(AMP_MODELS, value as string);
        case 'inputMode':
            return getOptionIndex(INPUT_MODES, value as string);
        case 'toneStackType':
            return getOptionIndex(TONE_STACK_TYPES, value as string);
        case 'powerTubeType':
            return getOptionIndex(POWER_TUBE_TYPES, value as string);
        case 'rectifierType':
            return getOptionIndex(RECTIFIER_TYPES, value as string);
        case 'cabType':
            return getOptionIndex(CAB_TYPES, value as string);
        case 'neuralPlacement':
            return getOptionIndex(NEURAL_PLACEMENTS, value as string);
        case 'neuralTier':
            return getOptionIndex(NEURAL_TIERS, value as string);
        case 'routingMode':
            return getOptionIndex(ROUTING_MODES, value as string);
        default:
            return null;
    }
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

    const preCompressor = findFirstPedal(patch.prePedals, ['compressor']);
    const preOverdrive = selectOverdriveFamilyPedal(patch.prePedals);
    const preDistortion = findFirstPedal(patch.prePedals, ['distortion']);
    const preFuzz = findFirstPedal(patch.prePedals, ['fuzz']);
    addParameter('preCompressorEnabled', preCompressor?.enabled ? 1 : 0);
    addParameter(
        'preCompressorThreshold',
        preCompressor?.params.threshold ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.threshold
    );
    addParameter('preCompressorRatio', preCompressor?.params.ratio ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.ratio);
    addParameter('preCompressorAttack', preCompressor?.params.attack ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.attack);
    addParameter(
        'preCompressorRelease',
        preCompressor?.params.release ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.release
    );
    addParameter('preOverdriveEnabled', preOverdrive?.enabled ? 1 : 0);
    addParameter('preOverdriveDrive', preOverdrive?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.drive);
    addParameter('preOverdriveTone', preOverdrive?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.tone);
    addParameter('preOverdriveLevel', preOverdrive?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.level);
    addParameter('preDistortionEnabled', preDistortion?.enabled ? 1 : 0);
    addParameter('preDistortionDrive', preDistortion?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.drive);
    addParameter('preDistortionTone', preDistortion?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.tone);
    addParameter('preDistortionLevel', preDistortion?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.level);
    addParameter('preFuzzEnabled', preFuzz?.enabled ? 1 : 0);
    addParameter('preFuzzFuzz', preFuzz?.params.fuzz ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.fuzz);
    addParameter('preFuzzTone', preFuzz?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.tone);
    addParameter('preFuzzLevel', preFuzz?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.level);

    const postCompressor = findFirstPedal(patch.postPedals, ['compressor']);
    const postOverdrive = selectOverdriveFamilyPedal(patch.postPedals);
    const postDistortion = findFirstPedal(patch.postPedals, ['distortion']);
    const postFuzz = findFirstPedal(patch.postPedals, ['fuzz']);
    addParameter('postCompressorEnabled', postCompressor?.enabled ? 1 : 0);
    addParameter(
        'postCompressorThreshold',
        postCompressor?.params.threshold ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.threshold
    );
    addParameter('postCompressorRatio', postCompressor?.params.ratio ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.ratio);
    addParameter(
        'postCompressorAttack',
        postCompressor?.params.attack ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.attack
    );
    addParameter(
        'postCompressorRelease',
        postCompressor?.params.release ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.release
    );
    addParameter('postOverdriveEnabled', postOverdrive?.enabled ? 1 : 0);
    addParameter('postOverdriveDrive', postOverdrive?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.drive);
    addParameter('postOverdriveTone', postOverdrive?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.tone);
    addParameter('postOverdriveLevel', postOverdrive?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.level);
    addParameter('postDistortionEnabled', postDistortion?.enabled ? 1 : 0);
    addParameter('postDistortionDrive', postDistortion?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.drive);
    addParameter('postDistortionTone', postDistortion?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.tone);
    addParameter('postDistortionLevel', postDistortion?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.level);
    addParameter('postFuzzEnabled', postFuzz?.enabled ? 1 : 0);
    addParameter('postFuzzFuzz', postFuzz?.params.fuzz ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.fuzz);
    addParameter('postFuzzTone', postFuzz?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.tone);
    addParameter('postFuzzLevel', postFuzz?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.level);

    for (const entry of getPedalOrderAudioEntries(false, patch.prePedals)) {
        addParameter(entry.key, entry.value);
    }

    for (const entry of getPedalOrderAudioEntries(true, patch.postPedals)) {
        addParameter(entry.key, entry.value);
    }

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
        if (importedModel.model !== null && importedModel.model !== undefined) {
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
