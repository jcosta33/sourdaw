import { resolveEligibleDeviceWriteTarget } from '#/modules/Arrangement/stores';
import { persistDevicePatch } from '#/modules/Arrangement/useCases';

import { type ProofPatch, type ProofPatchEdit } from '../../models/ProofPatch';
import { ditherModeToInt } from '../../services/ditherModeToInt';
import { isValidDynCrossoverFreqs } from '../../services/isValidDynCrossoverFreqs';
import { isValidProofPatch } from '../../services/isValidProofPatch';
import { getProofState, updateProofPatch } from '../../stores/proofStore';

import { bridges } from './helpers';
import { syncDynBands } from './syncDynBands';
import { syncEqBands } from './syncEqBands';
import { syncExciter } from './syncExciter';
import { syncFullPatch } from './syncFullPatch';
import { syncImager } from './syncImager';

type SetProofParamWithPatchInput = ProofPatchEdit & { deviceId: string };

type GetMappedScalarParamOutput = {
    name: string;
    value: number;
} | null;

type ProofEngineParam = NonNullable<GetMappedScalarParamOutput>;

function setObjectField<ObjectType extends object, Key extends keyof ObjectType>(
    object: ObjectType,
    key: Key,
    value: ObjectType[Key]
): void {
    object[key] = value;
}

function mergeChangedBands<Item extends object, Change extends { bandIndex: number; field: keyof Item }>(
    current: readonly Item[],
    requested: readonly Item[],
    changes: readonly Change[]
): { value: Item[]; changedParams: Change[] } {
    const value = current.map((item) => ({ ...item }));
    const changedParams = changes.flatMap((change) => {
        const currentBand = value[change.bandIndex];
        const requestedBand = requested[change.bandIndex];
        if (!currentBand || !requestedBand || Object.is(currentBand[change.field], requestedBand[change.field])) {
            return [];
        }
        setObjectField(currentBand, change.field, requestedBand[change.field]);
        return [change];
    });
    return { value, changedParams };
}

function getPersistedPatchParams(input: ProofPatchEdit): ProofEngineParam[] {
    switch (input.key) {
        case 'eqBands':
            return input.value.flatMap((band, index) => [
                { name: `eq_band${index}_freq`, value: band.freq },
                { name: `eq_band${index}_gain`, value: band.gain },
                { name: `eq_band${index}_q`, value: band.q },
                { name: `eq_band${index}_type`, value: band.type },
                { name: `eq_band${index}_channel`, value: band.channel },
                { name: `eq_band${index}_enabled`, value: band.enabled ? 1 : 0 },
            ]);
        case 'dynCrossoverFreqs':
            return input.value.map((value, index) => ({ name: `dyn_xover${index}`, value }));
        case 'dynBands':
            return input.value.flatMap((band, index) => [
                { name: `dyn_band${index}_threshold`, value: band.threshold },
                { name: `dyn_band${index}_ratio`, value: band.ratio },
                { name: `dyn_band${index}_attack`, value: band.attack },
                { name: `dyn_band${index}_release`, value: band.release },
                { name: `dyn_band${index}_knee`, value: band.knee },
                { name: `dyn_band${index}_makeup`, value: band.makeup },
                { name: `dyn_band${index}_auto_makeup`, value: band.autoMakeup ? 1 : 0 },
                { name: `dyn_band${index}_bypass`, value: band.bypassed ? 1 : 0 },
            ]);
        case 'imgBandWidth':
            return input.value.map((value, index) => ({ name: `img_width${index}`, value }));
        case 'excBands':
            return input.value.flatMap((band, index) => [
                { name: `exc_band${index}_type`, value: band.type },
                { name: `exc_band${index}_drive`, value: band.drive },
                { name: `exc_band${index}_blend`, value: band.blend },
                { name: `exc_band${index}_enabled`, value: band.enabled ? 1 : 0 },
            ]);
        case 'chainOrder':
            return input.value.map((value, index) => ({ name: `chain_order_${index}`, value }));
        case 'inputGain':
        case 'outputGain':
        case 'eqBypassed':
        case 'dynBypassed':
        case 'imgBypassed':
        case 'imgAutoMonoBass':
        case 'imgMonoBassFreq':
        case 'excBypassed':
        case 'limBypassed':
        case 'limCeiling':
        case 'limRelease':
        case 'limLookahead':
        case 'ditherMode':
        case 'ditherBits':
            return [];
    }

    return [];
}

function toEngineValue(value: number | boolean): number {
    if (typeof value === 'boolean') {
        return value ? 1 : 0;
    }

    return value;
}

function getDynBandFieldName(
    field: 'threshold' | 'ratio' | 'attack' | 'release' | 'knee' | 'makeup' | 'autoMakeup' | 'bypassed'
): string {
    if (field === 'autoMakeup') {
        return 'auto_makeup';
    }
    if (field === 'bypassed') {
        return 'bypass';
    }
    return field;
}

function getChangedPatchParams(input: ProofPatchEdit): ProofEngineParam[] | null {
    if (!('changedParams' in input) || input.changedParams === undefined) {
        return null;
    }

    switch (input.key) {
        case 'eqBands':
            return input.changedParams.flatMap(({ bandIndex, field }) => {
                const band = input.value[bandIndex];
                if (!band) {
                    return [];
                }
                const value = band[field];
                return [{ name: `eq_band${bandIndex}_${field}`, value: toEngineValue(value) }];
            });
        case 'dynCrossoverFreqs':
            return input.changedParams.flatMap(({ crossoverIndex }) => {
                const value = input.value[crossoverIndex];
                return value === undefined ? [] : [{ name: `dyn_xover${crossoverIndex}`, value }];
            });
        case 'dynBands':
            return input.changedParams.flatMap(({ bandIndex, field }) => {
                const band = input.value[bandIndex];
                if (!band) {
                    return [];
                }
                const value = band[field];
                return [
                    {
                        name: `dyn_band${bandIndex}_${getDynBandFieldName(field)}`,
                        value: toEngineValue(value),
                    },
                ];
            });
        case 'imgBandWidth':
            return input.changedParams.flatMap(({ bandIndex }) => {
                const value = input.value[bandIndex];
                return value === undefined ? [] : [{ name: `img_width${bandIndex}`, value }];
            });
        case 'excBands':
            return input.changedParams.flatMap(({ bandIndex, field }) => {
                const band = input.value[bandIndex];
                if (!band) {
                    return [];
                }
                const value = band[field];
                return [
                    {
                        name: `exc_band${bandIndex}_${field}`,
                        value: toEngineValue(value),
                    },
                ];
            });
    }

    return null;
}

type NormalizedChangedAggregateEdit = {
    patch: Partial<ProofPatch>;
    persistedParams: ProofEngineParam[];
    changedParams: ProofEngineParam[];
    isTransient: boolean;
    valid: boolean;
};

function createNormalizedChangedAggregateEdit(
    input: ProofPatchEdit,
    patch: Partial<ProofPatch>,
    valid = true
): NormalizedChangedAggregateEdit {
    return {
        patch,
        persistedParams: getPersistedPatchParams(input),
        changedParams: getChangedPatchParams(input) ?? [],
        isTransient: input.isTransient === true,
        valid,
    };
}

function normalizeChangedAggregateEdit(
    input: ProofPatchEdit,
    patch: ProofPatch
): NormalizedChangedAggregateEdit | null {
    if (!('changedParams' in input) || input.changedParams === undefined) {
        return null;
    }

    switch (input.key) {
        case 'eqBands': {
            const { value, changedParams } = mergeChangedBands(patch.eqBands, input.value, input.changedParams);
            const normalizedInput = { ...input, value, changedParams };
            return createNormalizedChangedAggregateEdit(normalizedInput, { eqBands: value });
        }
        case 'dynCrossoverFreqs': {
            const value: ProofPatch['dynCrossoverFreqs'] = [...patch.dynCrossoverFreqs];
            const changedParams = input.changedParams.flatMap((change) => {
                const currentValue = value[change.crossoverIndex];
                const requestedValue = input.value[change.crossoverIndex];
                if (
                    currentValue === undefined ||
                    requestedValue === undefined ||
                    Object.is(currentValue, requestedValue)
                ) {
                    return [];
                }
                value[change.crossoverIndex] = requestedValue;
                return [change];
            });
            const normalizedInput = { ...input, value, changedParams };
            return createNormalizedChangedAggregateEdit(
                normalizedInput,
                { dynCrossoverFreqs: value },
                isValidDynCrossoverFreqs(value)
            );
        }
        case 'dynBands': {
            const { value, changedParams } = mergeChangedBands(patch.dynBands, input.value, input.changedParams);
            const normalizedInput = { ...input, value, changedParams };
            return createNormalizedChangedAggregateEdit(normalizedInput, { dynBands: value });
        }
        case 'imgBandWidth': {
            const value: ProofPatch['imgBandWidth'] = [...patch.imgBandWidth];
            const changedParams = input.changedParams.flatMap((change) => {
                const currentValue = value[change.bandIndex];
                const requestedValue = input.value[change.bandIndex];
                if (
                    currentValue === undefined ||
                    requestedValue === undefined ||
                    Object.is(currentValue, requestedValue)
                ) {
                    return [];
                }
                value[change.bandIndex] = requestedValue;
                return [change];
            });
            const normalizedInput = { ...input, value, changedParams };
            return createNormalizedChangedAggregateEdit(normalizedInput, { imgBandWidth: value });
        }
        case 'excBands': {
            const { value, changedParams } = mergeChangedBands(patch.excBands, input.value, input.changedParams);
            const normalizedInput = { ...input, value, changedParams };
            return createNormalizedChangedAggregateEdit(normalizedInput, { excBands: value });
        }
    }

    return null;
}

function getMappedScalarParam(input: ProofPatchEdit): GetMappedScalarParamOutput {
    switch (input.key) {
        case 'inputGain':
            return { name: 'input_gain', value: input.value };
        case 'outputGain':
            return { name: 'output_gain', value: input.value };
        case 'eqBypassed':
            return { name: 'eq_bypass', value: input.value ? 1 : 0 };
        case 'dynBypassed':
            return { name: 'dyn_bypass', value: input.value ? 1 : 0 };
        case 'imgBypassed':
            return { name: 'img_bypass', value: input.value ? 1 : 0 };
        case 'excBypassed':
            return { name: 'exc_bypass', value: input.value ? 1 : 0 };
        case 'limBypassed':
            return { name: 'lim_bypass', value: input.value ? 1 : 0 };
        case 'limCeiling':
            return { name: 'lim_ceiling', value: input.value };
        case 'limRelease':
            return { name: 'lim_release', value: input.value };
        case 'limLookahead':
            return { name: 'lim_lookahead', value: input.value };
        case 'imgAutoMonoBass':
            return { name: 'img_auto_mono_bass', value: input.value ? 1 : 0 };
        case 'imgMonoBassFreq':
            return { name: 'img_mono_bass_freq', value: input.value };
        case 'ditherMode':
            return { name: 'dither_mode', value: ditherModeToInt(input.value) };
        case 'ditherBits':
            return { name: 'dither_bits', value: input.value };
        case 'chainOrder':
        case 'eqBands':
        case 'dynCrossoverFreqs':
        case 'dynBands':
        case 'imgBandWidth':
        case 'excBands':
            return null;
    }
    return null;
}

type SetProofParamWithPatchOutput = void;

/** Set a patch parameter and send to audio engine. */
export function setProofParamWithPatch(input: SetProofParamWithPatchInput): SetProofParamWithPatchOutput {
    const { deviceId } = input;
    const target = resolveEligibleDeviceWriteTarget(deviceId);
    if (target.status !== 'eligible') {
        return;
    }

    // Before bridge registration, a full sync has no engine side effects and
    // ensures saved project values hydrate before this edit takes precedence.
    if (!bridges.has(deviceId)) {
        syncFullPatch(deviceId);
    }

    const currentPatch = getProofState(deviceId).patch;
    const normalizedAggregate = normalizeChangedAggregateEdit(input, currentPatch);
    if (normalizedAggregate) {
        const nextPatch: ProofPatch = { ...currentPatch, ...normalizedAggregate.patch };
        if (!normalizedAggregate.valid || !isValidProofPatch(nextPatch)) {
            return;
        }

        updateProofPatch({
            deviceId,
            patch: normalizedAggregate.patch,
            preservePresetId: normalizedAggregate.isTransient,
        });
        if (!normalizedAggregate.isTransient && normalizedAggregate.persistedParams.length > 0) {
            persistDevicePatch(
                deviceId,
                Object.fromEntries(normalizedAggregate.persistedParams.map((param) => [param.name, param.value]))
            );
        }

        const bridge = bridges.get(deviceId);
        if (bridge) {
            for (const param of normalizedAggregate.changedParams) {
                bridge.setParam(param.name, param.value);
            }
        }
        return;
    }

    const { key, value } = input;
    const nextPatch: ProofPatch = { ...currentPatch, [key]: value };
    if (!isValidProofPatch(nextPatch)) {
        return;
    }
    const valueChanged = !Object.is(currentPatch[key], value);
    updateProofPatch({
        deviceId,
        patch: { [key]: value },
        preservePresetId: input.isTransient === true,
    });

    const mapped_param = getMappedScalarParam(input);
    const persisted_params = mapped_param ? [mapped_param] : getPersistedPatchParams(input);
    if (!input.isTransient && persisted_params.length > 0) {
        persistDevicePatch(deviceId, Object.fromEntries(persisted_params.map((param) => [param.name, param.value])));
    }

    const bridge = bridges.get(deviceId);
    if (!bridge) {
        return;
    }

    if (mapped_param) {
        if (valueChanged) {
            bridge.setParam(mapped_param.name, mapped_param.value);
        }
        return;
    }

    if (input.key === 'eqBands') {
        syncEqBands(deviceId);
    } else if (input.key === 'dynBands' || input.key === 'dynCrossoverFreqs') {
        syncDynBands(deviceId);
    } else if (input.key === 'imgBandWidth') {
        syncImager(deviceId);
    } else if (input.key === 'excBands') {
        syncExciter(deviceId);
    } else if (input.key === 'chainOrder') {
        bridge.reorderModules(input.value);
    }
}
