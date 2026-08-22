import { subscribeToGrandBouleStoreCreation } from '../stores/grandBouleStore';

import { commitGrandBouleDeviceState } from './commitGrandBouleDeviceState';

function morphKey(morph: {
    modelA: string;
    modelB: string;
    morphPosition: number;
    layerBalance: number;
    enabled: boolean;
}): string {
    return JSON.stringify(morph);
}

export function initGrandBouleDeviceStatePersistence(): () => void {
    const unsubs = new Map<string, () => void>();
    const stopCreation = subscribeToGrandBouleStoreCreation((deviceId, store) => {
        if (unsubs.has(deviceId)) {
            return;
        }
        let previous = morphKey(
            store.value?.morph ?? {
                modelA: '',
                modelB: '',
                morphPosition: 0,
                layerBalance: 0,
                enabled: false,
            }
        );
        unsubs.set(
            deviceId,
            store.subscribe((state) => {
                if (!state) {
                    return;
                }
                const current = morphKey(state.morph);
                if (current !== previous) {
                    previous = current;
                    commitGrandBouleDeviceState(deviceId);
                }
            })
        );
    });
    return () => {
        stopCreation();
        for (const unsub of unsubs.values()) {
            unsub();
        }
    };
}
