import { inject } from '#/infra/di/inject';
import { updateTrack } from '#/modules/Arrangement/repositories/track/updateTrack';

export const setAutomationMode = inject({ updateTrack })(
    ({ updateTrack }) =>
        function setAutomationMode(trackId: string, mode: 'read' | 'write' | 'touch' | 'latch' | 'off'): void {
            updateTrack(trackId, (t) => ({ ...t, automationMode: mode }));
        }
);
