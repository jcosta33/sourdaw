import { Store } from '#/helpers/Store/Store';
import { Container } from '#/helpers/DependencyInjector/Container';
import { Logger } from '#/helpers/Logger/Logger';

import { type CollaborationState } from '../models/CollaborationTypes';

const logger = Container.getInstance().get(Logger);

const initialState: CollaborationState = {
    isEnabled: false,
    sessionId: null,
    localPeerId: null,
    localName: '',
    localColor: '',
    isHost: false,
    approvalRequired: false,
    pendingJoinRequests: [],
    peers: [],
    connectionStatus: 'disconnected',
    error: null,
};

export const collaborationStore = new Store<CollaborationState>(logger, {
    initialData: initialState,
});
