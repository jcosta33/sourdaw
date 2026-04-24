import { levainBridge } from './levainBridge';

export const sendHumanizeToEngine = (deviceId: string, amount: number): void => {
    levainBridge().sendHumanizeToEngine(deviceId, amount);
};
