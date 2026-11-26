import { handleSetToasterFactoryKit } from '../handlers/handleSetToasterFactoryKit';
import { handleSetToasterMasterGain } from '../handlers/handleSetToasterMasterGain';

export function getToasterHandlers() {
    return { setToasterFactoryKit: handleSetToasterFactoryKit, setToasterMasterGain: handleSetToasterMasterGain };
}
