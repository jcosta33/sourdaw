import { levainBridge } from './levainBridge';

export function setMacroWithAudio(index: number, value: number): void {
    levainBridge().setMacroWithAudio(index, value);
}
