import { setSend as setSendEngine } from '#/modules/AudioEngine/useCases';

export function setSend(sourceTrackId: string, busId: string, level: number, preFader = false): void {
    setSendEngine(sourceTrackId, busId, level, preFader);
}
