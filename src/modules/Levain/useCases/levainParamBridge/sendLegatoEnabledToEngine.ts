import { levainBridge } from './levainBridge';

export const sendLegatoEnabledToEngine = (deviceId: string, enabled: boolean): void => {
    levainBridge().sendLegatoEnabledToEngine(deviceId, enabled);
};
