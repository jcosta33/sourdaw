import { type AppAction } from '#/modules/Command/useCases/commandQueries';
import { executeAppAction } from '#/modules/Command/useCases/executeAppAction';
import { type SyncMessage } from '../../models/CollaborationTypes';
import { collaborationStore } from '../../stores/collaborationStore';
import { appendLocalOperation, appendRemoteOperation } from '../operationLog';
import * as transport from '../../repositories/webSocketTransport';

export function broadcastAction(action: AppAction): void {
    const state = collaborationStore.value;
    if (!state?.isEnabled || !state.localPeerId || !state.sessionId) {
        return;
    }

    appendLocalOperation(state.localPeerId, action);
    transport.send({
        type: 'action',
        peerId: state.localPeerId,
        sessionId: state.sessionId,
        action,
        timestamp: Date.now(),
    } as unknown as SyncMessage);
}

export function updateCursor(trackId: string, beat: number): void {
    const state = collaborationStore.value;
    if (!state?.isEnabled || !state.localPeerId || !state.sessionId) {
        return;
    }

    transport.send({
        type: 'cursor',
        peerId: state.localPeerId,
        sessionId: state.sessionId,
        cursor: { trackId, beat },
    } as unknown as SyncMessage);
}

export const receiveRemoteAction = async (entry: {
    id: string;
    peerId: string;
    action: AppAction;
    timestamp: number;
    vectorClock: Record<string, number>;
}): Promise<void> => {
    appendRemoteOperation(entry);
    await executeAppAction(entry.action);
};
