import { releaseTouchAutomation } from './releaseTouchAutomation';

export function captureTouchAutomationRecordingAuthority(trackId: string, parameterId: string) {
    const owner = Symbol('Touch automation producer');
    return { owner, release: () => releaseTouchAutomation(trackId, parameterId, owner) };
}
