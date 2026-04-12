import { updateTrack } from '../../repositories/track/updateTrack';

export function setAutomationMode(trackId: string, mode: 'read' | 'write' | 'touch' | 'latch' | 'off'): void {
    updateTrack(trackId, (t) => ({ ...t, automationMode: mode }));
}
