import { levainBridge } from './levainBridge';

export function sendMicParamToEngine(micIndex: number, param: string, value: number): void {
    levainBridge().sendMicParamToEngine(micIndex, param, value);
}
