import { collaborationStore } from '../../stores/collaborationStore';
import { type PresenceData } from '../collaborationQueries';

import { sessionRuntimePrimitives as runtime } from './sessionManagement';

export function broadcastPresence(data: Partial<Omit<PresenceData, 'peerId' | 'name' | 'color'>>): void {
    if (!runtime.state.peerManager) {
        return;
    }

    const state = collaborationStore.value;
    if (!state?.localPeerId) {
        return;
    }

    runtime.state.peerManager.broadcastPresence({
        type: 'presence',
        data: {
            ...data,
            peerId: state.localPeerId,
            name: state.localName,
            color: state.localColor,
        },
    });
}
