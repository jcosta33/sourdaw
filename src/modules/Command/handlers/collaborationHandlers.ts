import { type ActionHandler } from '../models/ActionHandler';
import { type AppAction } from '../models/AppAction';
import { createSession, joinSession, leaveSession } from '#/modules/Collaboration/useCases/collaborationUseCases';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const collaborationHandlers = {
    createCollabSession: {
        execute: () => {
            createSession();
        },
        describe: () => ({ label: 'Create collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'createCollabSession'>>,

    joinCollabSession: {
        execute: (a) => {
            joinSession(a.payload.sessionId, a.payload.peerName);
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
