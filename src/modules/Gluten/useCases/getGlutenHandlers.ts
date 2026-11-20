import { handleSetGlutenFactoryPreset } from '../handlers/handleSetGlutenFactoryPreset';

export function getGlutenHandlers() {
    return { setGlutenFactoryPreset: handleSetGlutenFactoryPreset };
}
