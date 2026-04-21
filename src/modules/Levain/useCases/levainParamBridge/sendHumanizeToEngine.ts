import { levainBridge } from './levainBridge';

export function sendHumanizeToEngine(amount: number): void {
    levainBridge().sendHumanizeToEngine(amount);
}
