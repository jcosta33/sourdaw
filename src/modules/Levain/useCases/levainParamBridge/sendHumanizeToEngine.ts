import { levainBridge } from './levainBridge';

export const sendHumanizeToEngine = (amount: number): void => {
    levainBridge().sendHumanizeToEngine(amount);
};
