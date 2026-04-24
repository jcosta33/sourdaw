import { levainBridge } from './levainBridge';

export const sendMicParamToEngine = (deviceId: string, micIndex: number, param: string, value: number): void => {
    levainBridge().sendMicParamToEngine(deviceId, micIndex, param, value);
};
