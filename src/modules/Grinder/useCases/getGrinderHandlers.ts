import { handleSetGrinderFactoryPreset } from '../handlers/handleSetGrinderFactoryPreset';

export function getGrinderHandlers() {
    return { setGrinderFactoryPreset: handleSetGrinderFactoryPreset };
}
