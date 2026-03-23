import { updateTrack } from '#/modules/Track/repositories/trackRepository';

export function setAutomationMode(trackId: string, mode: 'read' | 'write' | 'touch' | 'latch' | 'off'): void {
    updateTrack(trackId, (t) => ({ ...t, automationMode: mode }));
}
