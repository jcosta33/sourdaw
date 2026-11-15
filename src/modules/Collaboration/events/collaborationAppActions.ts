export type CollaborationAppAction =
    | { type: 'createCollabSession'; payload: { name?: string } }
    | { type: 'joinCollabSession'; payload: { inviteString: string; peerName?: string } }
    | { type: 'leaveCollabSession'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        collaboration: CollaborationAppAction;
    }
}
