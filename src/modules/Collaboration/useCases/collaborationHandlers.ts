import { inject } from '#/infra/di/inject';
import { type ActionHandler, type AppAction } from '#/modules/Command/useCases/commandQueries';
import {
    createSession,
    joinSession,
    leaveSession,
} from '#/modules/Collaboration/useCases/collaboration/sessionManagement';

type Extract<A extends AppAction, T extends string> = A extends { type: T } ? A : never;

export const executeCreateCollabSession = inject({ createSession })(
    ({ createSession }) =>
        function executeCreateCollabSession(a: Extract<AppAction, 'createCollabSession'>): void {
            createSession(a.payload.name ?? 'Host');
        }
);

export const executeJoinCollabSession = inject({ joinSession })(
    ({ joinSession }) =>
        async function executeJoinCollabSession(a: Extract<AppAction, 'joinCollabSession'>): Promise<void> {
            await joinSession(a.payload.inviteString, a.payload.peerName ?? 'Peer');
        }
);

export const executeLeaveCollabSession = inject({ leaveSession })(
    ({ leaveSession }) =>
        function executeLeaveCollabSession(): void {
            leaveSession();
        }
);

export const collaborationHandlers = {
    createCollabSession: {
        execute: executeCreateCollabSession,
        describe: () => ({ label: 'Create collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'createCollabSession'>>,

    joinCollabSession: {
        execute: executeJoinCollabSession,
        describe: () => ({ label: 'Join collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'joinCollabSession'>>,

    leaveCollabSession: {
        execute: executeLeaveCollabSession,
        describe: () => ({ label: 'Leave collaboration session' }),
        undoable: false,
    } satisfies ActionHandler<Extract<AppAction, 'leaveCollabSession'>>,
};
