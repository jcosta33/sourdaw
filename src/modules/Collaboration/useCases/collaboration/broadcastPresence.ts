import { type PresenceData } from '../collaborationQueries';

import { collaborationSessionRuntime } from './sessionManagement';

export function broadcastPresence(data: Partial<Omit<PresenceData, 'peerId' | 'name' | 'color'>>): void {
    collaborationSessionRuntime.broadcastPresence(data);
}
