import { updateTrack } from '#/modules/Arrangement/repositories/track';

export function setAutomationMode(trackId: string, mode: 'read' | 'write' | 'touch' | 'latch' | 'off'): void {
    updateTrack(trackId, (t) => ({ ...t, automationMode: mode }));
}
