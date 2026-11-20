import { handleSetLevainIdentity } from '../handlers/handleSetLevainIdentity';

export function getLevainHandlers() {
    return { setLevainIdentity: handleSetLevainIdentity };
}
