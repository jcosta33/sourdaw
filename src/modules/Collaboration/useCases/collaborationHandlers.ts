import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import { createSession, joinSession, leaveSession } from '#/modules/Collaboration/useCases/collaboration/sessionManagement';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const collaborationHandlers = {
    createCollabSession: {
        execute: (a) => {
            createSession(a.payload.name ?? 'Host');
        },
        describe: () => ({ label: 'Create collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'createCollabSession'>>,

    joinCollabSession: {
        execute: async (a) => {
            await joinSession(a.payload.inviteString, a.payload.peerName ?? 'Peer');
        },
        describe: () => ({ label: 'Join collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'joinCollabSession'>>,

    leaveCollabSession: {
        execute: () => {
            leaveSession();
        },
        describe: () => ({ label: 'Leave collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'leaveCollabSession'>>,
};
