import { levainBridge } from './levainBridge';

export const setMacroWithAudio = (deviceId: string, index: number, value: number): void => {
    levainBridge().setMacroWithAudio(deviceId, index, value);
};
