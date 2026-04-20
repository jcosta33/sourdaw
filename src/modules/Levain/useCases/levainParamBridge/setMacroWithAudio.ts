import { levainBridge } from './levainBridge';

export const setMacroWithAudio = (index: number, value: number): void => {
    levainBridge().setMacroWithAudio(index, value);
};
