import { levainBridge } from './levainBridge';

export function sendLegatoEnabledToEngine(enabled: boolean): void {
    levainBridge().sendLegatoEnabledToEngine(enabled);
}
