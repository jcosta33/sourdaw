import { useStoreSelector } from '#/infra/store/useStoreSelector';

import { fermenterStore, type FermenterState } from '../../stores/fermenterStore';

export function useFermenterBuffer(deviceId: string) {
    return useStoreSelector(
        fermenterStore,
        (state: Record<string, FermenterState> | null) => {
            if (!state) {
                return null;
            }
            const s = state[deviceId];
            return s ? s.scopeBuffer : null;
        },
        (a, b) => a === b
    );
}

export function useFermenterPeaks(deviceId: string) {
    return useStoreSelector(
        fermenterStore,
        (state: Record<string, FermenterState> | null) => {
            if (!state) {
                return { peakL: 0, peakR: 0 };
            }
            const s = state[deviceId];
            return s ? { peakL: s.peakL, peakR: s.peakR } : { peakL: 0, peakR: 0 };
        },
        (a, b) => a.peakL === b.peakL && a.peakR === b.peakR
    );
}
