import { createHandler } from '#/helpers/createHandler';
import { joinSession } from '../../useCases/collaboration/sessionManagement';

export const handleJoinCollabSession = createHandler<'joinCollabSession'>({
    execute: async (a) => {
        await joinSession(a.payload.inviteString, a.payload.peerName ?? 'Peer');
    },
    describe: () => ({ label: 'Join collaboration session' }),
    undoable: false,
});
