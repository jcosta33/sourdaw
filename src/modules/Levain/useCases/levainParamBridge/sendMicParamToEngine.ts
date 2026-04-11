import { levainBridge } from './levainBridge';

export const sendMicParamToEngine = (micIndex: number, param: string, value: number): void => {
    levainBridge().sendMicParamToEngine(micIndex, param, value);
};