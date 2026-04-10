/**
 * Use case for audio device management on track channel strips.
 *
 * Handles adding, removing, and updating device parameters on tracks.
 */
import { audioEngine } from '../repositories/createWebAudioEngine';

export function addDeviceToStrip(
    trackId: string,
    deviceId: string,
    deviceType: string,
    externalInstanceId?: string
): void {
    audioEngine.addDeviceToStrip(trackId, deviceId, deviceType, externalInstanceId);
}

export function removeDeviceFromStrip(trackId: string, deviceId: string): void {
    audioEngine.removeDeviceFromStrip(trackId, deviceId);
}

export function updateDeviceParam(trackId: string, deviceId: string, paramId: string, value: number): void {
    audioEngine.updateDeviceParam(trackId, deviceId, paramId, value);
}

export function scheduleDeviceParam(
    trackId: string,
    deviceId: string,
    paramId: string,
    value: number,
    time: number
): void {
    audioEngine.scheduleDeviceParam(trackId, deviceId, paramId, value, time);
}

export function updateDeviceBypass(trackId: string, deviceId: string, bypassed: boolean): void {
    audioEngine.updateDeviceBypass(trackId, deviceId, bypassed);
}
