import { levainBridge } from './levainBridge';

export const sendLegatoEnabledToEngine = (enabled: boolean): void => {
    levainBridge().sendLegatoEnabledToEngine(enabled);
};