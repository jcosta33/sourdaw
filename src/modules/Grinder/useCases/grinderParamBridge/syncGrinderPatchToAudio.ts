import { type resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { type DeviceRef } from '#/utils/createFindDeviceRef';

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

type SyncGrinderPatchToAudioInput = {
    patch: GrinderPatch;
    ref: DeviceRef;
    persist_device_param: (device_id: string, key: string, value: number) => void;
    update_device_param: (track_id: string, device_id: string, key: string, value: number) => void;
    update_device_patch: (track_id: string, device_id: string, patch: Record<string, unknown>) => void;
    resolve_eligible_device_write_target: typeof resolveEligibleDeviceWriteTarget;
};

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

function sendNumericParamToDevice(
    input: Pick<SyncGrinderPatchToAudioInput, 'persist_device_param' | 'ref' | 'update_device_param'>,
    key: string,
    value: number
): void {
    if (!Number.isFinite(value)) {
        return;
    }

    input.update_device_param(input.ref.trackId, input.ref.deviceId, key, value);
    input.persist_device_param(input.ref.deviceId, key, value);
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

function sendPatchToDevice(
    input: Pick<SyncGrinderPatchToAudioInput, 'ref' | 'update_device_patch'>,
    patch: GrinderNeuralAudioPatch
): void {
    input.update_device_patch(input.ref.trackId, input.ref.deviceId, patch);
}

export function syncGrinderPatchToAudio(input: SyncGrinderPatchToAudioInput): void {
    const target = input.resolve_eligible_device_write_target(input.ref.deviceId);
    if (target.status !== 'eligible' || target.trackId !== input.ref.trackId) {
        return;
    }

    // Callers (loadGrinderPatchWithAudio, recallGrinderSnapshotWithAudio) always pass an
    // already-migrated GrinderPatch, so this path does not migrate again.
    const patch = input.patch;
    const cab_ir_slot = getCabIrSlot(patch.cabIrId);

    if (cab_ir_slot !== null) {
        sendNumericParamToDevice(input, 'cabIrSlot', cab_ir_slot);
    }

    for (const key of GRINDER_PROJECT_PARAM_KEYS) {
        const value = toAudioValue(key, patch[key]);
        if (value === null) {
            continue;
        }

        sendNumericParamToDevice(input, key, value);
    }

    const preCompressor = findFirstPedal(patch.prePedals, ['compressor']);
    const preOverdrive = selectOverdriveFamilyPedal(patch.prePedals);
    const preDistortion = findFirstPedal(patch.prePedals, ['distortion']);
    const preFuzz = findFirstPedal(patch.prePedals, ['fuzz']);
    sendNumericParamToDevice(input, 'preCompressorEnabled', preCompressor?.enabled ? 1 : 0);
    sendNumericParamToDevice(
        input,
        'preCompressorThreshold',
        preCompressor?.params.threshold ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.threshold
    );
    sendNumericParamToDevice(
        input,
        'preCompressorRatio',
        preCompressor?.params.ratio ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.ratio
    );
    sendNumericParamToDevice(
        input,
        'preCompressorAttack',
        preCompressor?.params.attack ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.attack
    );
    sendNumericParamToDevice(
        input,
        'preCompressorRelease',
        preCompressor?.params.release ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.release
    );
    sendNumericParamToDevice(input, 'preOverdriveEnabled', preOverdrive?.enabled ? 1 : 0);
    sendNumericParamToDevice(
        input,
        'preOverdriveDrive',
        preOverdrive?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.drive
    );
    sendNumericParamToDevice(
        input,
        'preOverdriveTone',
        preOverdrive?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.tone
    );
    sendNumericParamToDevice(
        input,
        'preOverdriveLevel',
        preOverdrive?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.level
    );
    sendNumericParamToDevice(input, 'preDistortionEnabled', preDistortion?.enabled ? 1 : 0);
    sendNumericParamToDevice(
        input,
        'preDistortionDrive',
        preDistortion?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.drive
    );
    sendNumericParamToDevice(
        input,
        'preDistortionTone',
        preDistortion?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.tone
    );
    sendNumericParamToDevice(
        input,
        'preDistortionLevel',
        preDistortion?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.level
    );
    sendNumericParamToDevice(input, 'preFuzzEnabled', preFuzz?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'preFuzzFuzz', preFuzz?.params.fuzz ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.fuzz);
    sendNumericParamToDevice(input, 'preFuzzTone', preFuzz?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.tone);
    sendNumericParamToDevice(input, 'preFuzzLevel', preFuzz?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.level);

    const postCompressor = findFirstPedal(patch.postPedals, ['compressor']);
    const postOverdrive = selectOverdriveFamilyPedal(patch.postPedals);
    const postDistortion = findFirstPedal(patch.postPedals, ['distortion']);
    const postFuzz = findFirstPedal(patch.postPedals, ['fuzz']);
    sendNumericParamToDevice(input, 'postCompressorEnabled', postCompressor?.enabled ? 1 : 0);
    sendNumericParamToDevice(
        input,
        'postCompressorThreshold',
        postCompressor?.params.threshold ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.threshold
    );
    sendNumericParamToDevice(
        input,
        'postCompressorRatio',
        postCompressor?.params.ratio ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.ratio
    );
    sendNumericParamToDevice(
        input,
        'postCompressorAttack',
        postCompressor?.params.attack ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.attack
    );
    sendNumericParamToDevice(
        input,
        'postCompressorRelease',
        postCompressor?.params.release ?? DEFAULT_GRINDER_PEDAL_PARAMS.compressor.release
    );
    sendNumericParamToDevice(input, 'postOverdriveEnabled', postOverdrive?.enabled ? 1 : 0);
    sendNumericParamToDevice(
        input,
        'postOverdriveDrive',
        postOverdrive?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.drive
    );
    sendNumericParamToDevice(
        input,
        'postOverdriveTone',
        postOverdrive?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.tone
    );
    sendNumericParamToDevice(
        input,
        'postOverdriveLevel',
        postOverdrive?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.overdrive.level
    );
    sendNumericParamToDevice(input, 'postDistortionEnabled', postDistortion?.enabled ? 1 : 0);
    sendNumericParamToDevice(
        input,
        'postDistortionDrive',
        postDistortion?.params.drive ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.drive
    );
    sendNumericParamToDevice(
        input,
        'postDistortionTone',
        postDistortion?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.tone
    );
    sendNumericParamToDevice(
        input,
        'postDistortionLevel',
        postDistortion?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.distortion.level
    );
    sendNumericParamToDevice(input, 'postFuzzEnabled', postFuzz?.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'postFuzzFuzz', postFuzz?.params.fuzz ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.fuzz);
    sendNumericParamToDevice(input, 'postFuzzTone', postFuzz?.params.tone ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.tone);
    sendNumericParamToDevice(input, 'postFuzzLevel', postFuzz?.params.level ?? DEFAULT_GRINDER_PEDAL_PARAMS.fuzz.level);

    for (const entry of getPedalOrderAudioEntries(false, patch.prePedals)) {
        sendNumericParamToDevice(input, entry.key, entry.value);
    }

    for (const entry of getPedalOrderAudioEntries(true, patch.postPedals)) {
        sendNumericParamToDevice(input, entry.key, entry.value);
    }

    const importedModel = patch.neuralModelSource === 'imported' && patch.neuralModelProfile;
    sendNumericParamToDevice(input, 'neuralModelMode', importedModel ? 1 : 0);
    if (importedModel) {
        sendPatchToDevice(input, {
            neuralModelMode: 'imported',
            profile: importedModel,
        });
    } else {
        sendPatchToDevice(input, { neuralModelMode: 'builtin' });
        const neural_model_slot = getNeuralModelSlot(patch.neuralModelId);
        if (neural_model_slot !== null) {
            sendNumericParamToDevice(input, 'neuralModelSlot', neural_model_slot);
        }
    }

    sendNumericParamToDevice(input, 'mic1Enabled', patch.mic1.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'mic1PositionX', patch.mic1.positionX);
    sendNumericParamToDevice(input, 'mic1PositionY', patch.mic1.positionY);
    sendNumericParamToDevice(input, 'mic1Distance', patch.mic1.distance);
    sendNumericParamToDevice(input, 'mic1Gain', patch.mic1.gain);
    sendNumericParamToDevice(input, 'mic2Enabled', patch.mic2.enabled ? 1 : 0);
    sendNumericParamToDevice(input, 'mic2PositionX', patch.mic2.positionX);
    sendNumericParamToDevice(input, 'mic2PositionY', patch.mic2.positionY);
    sendNumericParamToDevice(input, 'mic2Distance', patch.mic2.distance);
    sendNumericParamToDevice(input, 'mic2Gain', patch.mic2.gain);
}
