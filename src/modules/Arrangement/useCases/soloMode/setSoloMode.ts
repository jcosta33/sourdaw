import { type SoloMode } from '../../services/applySoloLogic';
import { soloModeStore } from '../../stores/soloModeStore';

export const setSoloMode = (soloMode: SoloMode): void => {
    if (!soloModeStore.value) {
        return;
    }
    soloModeStore.set({ soloMode });
};
