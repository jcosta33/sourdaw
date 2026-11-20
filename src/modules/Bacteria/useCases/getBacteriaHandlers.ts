import { handleSetBacteriaFactoryPatch } from '../handlers/handleSetBacteriaFactoryPatch';

export function getBacteriaHandlers() {
    return { setBacteriaFactoryPatch: handleSetBacteriaFactoryPatch };
}
