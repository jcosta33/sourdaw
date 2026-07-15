import { createHandler } from '#/utils/createHandler';

import { joinSession } from '../../useCases/collaboration/joinSession';

export const handleJoinCollabSession = createHandler<'joinCollabSession'>({
    execute: async (alpha) => {
        await joinSession(alpha.payload.inviteString, alpha.payload.peerName ?? 'Peer');
    },
    describe: () => ({ label: 'Join collaboration session' }),
    undoable: false,
});
