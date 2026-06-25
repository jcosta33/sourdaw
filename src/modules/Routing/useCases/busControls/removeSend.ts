import { removeSend as removeSendEngine } from '#/modules/AudioEngine/useCases';

export function removeSend(sourceTrackId: string, busId: string): void {
    removeSendEngine(sourceTrackId, busId);
}
