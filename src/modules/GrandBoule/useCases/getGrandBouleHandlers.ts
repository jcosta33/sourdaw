import { handleSetGrandBouleDeviceState } from '../handlers/handleSetGrandBouleDeviceState';

export function getGrandBouleHandlers() {
    return { setGrandBouleDeviceState: handleSetGrandBouleDeviceState };
}
