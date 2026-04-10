import {
    createSession,
    joinSession,
    leaveSession,
} from '#/modules/Collaboration/useCases/collaboration/sessionManagement';

type CollaborationHandlerDescription = {
    label: string;
    inverseAction?: unknown;
};

type CollaborationHandler<Action> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => CollaborationHandlerDescription;
    undoable: boolean;
};

type CreateCollabSessionAction = {
    type: 'createCollabSession';
    payload: { name: string };
};

type JoinCollabSessionAction = {
    type: 'joinCollabSession';
    payload: { inviteString: string; peerName: string };
};

type LeaveCollabSessionAction = {
    type: 'leaveCollabSession';
    payload?: undefined;
};

export const collaborationHandlers = {
    createCollabSession: {
        execute: (a) => {
            createSession(a.payload.name ?? 'Host');
        },
        describe: () => ({ label: 'Create collaboration session' }),
        undoable: false,
    } satisfies CollaborationHandler<CreateCollabSessionAction>,

    joinCollabSession: {
        execute: async (a) => {
            await joinSession(a.payload.inviteString, a.payload.peerName ?? 'Peer');
        },
        describe: () => ({ label: 'Join collaboration session' }),
        undoable: false,
    } satisfies CollaborationHandler<JoinCollabSessionAction>,

    leaveCollabSession: {
        execute: () => {
            leaveSession();
        },
        describe: () => ({ label: 'Leave collaboration session' }),
        undoable: false,
    } satisfies CollaborationHandler<LeaveCollabSessionAction>,
};
