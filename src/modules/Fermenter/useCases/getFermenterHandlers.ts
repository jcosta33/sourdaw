import { handleSetFermenterPatch } from '../handlers/handleSetFermenterPatch';

export function getFermenterHandlers() {
    return { setFermenterPatch: handleSetFermenterPatch };
}
