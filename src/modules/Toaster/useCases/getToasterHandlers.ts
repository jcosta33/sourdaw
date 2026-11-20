import { handleSetToasterFactoryKit } from '../handlers/handleSetToasterFactoryKit';

export function getToasterHandlers() {
    return { setToasterFactoryKit: handleSetToasterFactoryKit };
}
