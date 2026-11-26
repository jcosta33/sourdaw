import { handleSetCrustFactoryPreset } from '../handlers/handleSetCrustFactoryPreset';

export function getCrustHandlers() {
    return { setCrustFactoryPreset: handleSetCrustFactoryPreset };
}
