/**
 * Use case for audio device management on track channel strips.
 *
 * Handles adding, removing, and updating device parameters on tracks.
 */
import { audioEngine } from '../repositories/audioEngineInstance';

export const addDeviceToStrip = (
    trackId: string,
    deviceId: string,
    deviceType: string,
    externalInstanceId?: string
): void => {
    audioEngine.addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId);
};

export const removeDeviceFromStrip = (trackId: string, deviceId: string): void => {
    audioEngine.removeDeviceFromStrip(trackId, deviceId);
};

export const updateDeviceParam = (trackId: string, deviceId: string, paramId: string, value: number): void => {
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, value);
};
