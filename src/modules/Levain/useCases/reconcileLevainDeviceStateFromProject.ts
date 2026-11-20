import { trackStore, type Device } from '#/modules/Arrangement/stores';

import { fromLevainDeviceState } from '../models/LevainDeviceState';
import { defaultLevainState, levainStore, setLevainParam, type LevainState } from '../stores/levainStore';

import { hydrateLevainStateFromDevice } from './hydrateLevainStateFromDevice';
import { applyPatchToEngine } from './levainParamBridge/applyPatchToEngine';
import { levainBridge } from './levainParamBridge/levainBridge';
import { loadSamplesForInstrument } from './levainParamBridge/loadSamplesForInstrument';
import { setLevainParamWithAudio } from './levainParamBridge/setLevainParamWithAudio';
import { readLevainMasterGain } from './readLevainMasterGain';

function projectInstrumentPatch(device: Device, state: LevainState, bankChanged: boolean): void {
    const projected = hydrateLevainStateFromDevice(device);
    const instances = levainStore.value ?? {};
    levainStore.set({
        ...instances,
        [device.id]: {
            ...state,
            patch: projected.patch,
            uiLevel: projected.uiLevel,
            currentArticulationDisplay: projected.currentArticulationDisplay,
        },
    });
    applyPatchToEngine(device.id, projected.patch);
    if (bankChanged) {
        loadSamplesForInstrument(device.id, projected.patch.instrumentId);
    }
}

function projectMasterGain(device: Device): void {
    const gain = readLevainMasterGain(device.parameterValues, defaultLevainState.patch.masterGain);
    if (levainStore.value?.[device.id]?.patch.masterGain !== gain && !levainBridge().isMasterGainQueued(device.id)) {
        setLevainParam(device.id, 'masterGain', gain);
    }
}

/** Reflect committed identity in the registered session. Only a Browse edit resets the stored settings. */
export function reconcileLevainDeviceStateFromProject(deviceId: string, { projectPatch = false } = {}): void {
    const owner = trackStore.value?.tracks.find(({ devices }) => devices.some(({ id }) => id === deviceId));
    const device = owner?.devices.find(({ id }) => id === deviceId);
    const state = levainStore.value?.[deviceId];
    if (device?.type !== 'levain' || owner?.frozen || !state) {
        return;
    }
    const identity = fromLevainDeviceState(device.deviceState);
    if (!identity && device.deviceState !== undefined) {
        projectMasterGain(device);
        return;
    }

    const bankChanged = state.patch.instrumentId !== (identity?.instrumentId ?? defaultLevainState.patch.instrumentId);
    if (projectPatch || bankChanged) {
        projectInstrumentPatch(device, state, bankChanged);
        return;
    }

    const uiLevel = identity?.disclosureTier === 'expert' ? 6 : 1;
    if (state.uiLevel !== uiLevel) {
        levainStore.set({ ...levainStore.value, [deviceId]: { ...state, uiLevel } });
    }
    const articulation = identity?.currentArticulation ?? defaultLevainState.patch.currentArticulation;
    if (state.patch.currentArticulation !== articulation) {
        setLevainParamWithAudio(deviceId, 'currentArticulation', articulation);
    }
    projectMasterGain(device);
}
