import { setDisplayScale } from '../repositories/setDisplayScale';

export function resetDisplayScaleForStartup(): Promise<void> {
    setDisplayScale(1);
    return Promise.resolve();
}
