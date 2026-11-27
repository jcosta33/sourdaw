import { type GrinderFactoryPresetAction } from '../events/grinderAppActions';

type Effect = (payload: GrinderFactoryPresetAction['payload']) => void;
let effect: Effect | undefined;

export const grinderFactoryPresetRuntimePort = {
    setEffect(next: Effect | undefined): void {
        effect = next;
    },
    publish(payload: GrinderFactoryPresetAction['payload']): void {
        effect?.(payload);
    },
};
