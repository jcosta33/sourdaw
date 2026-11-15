export type ControlRoomAppAction =
    | { type: 'toggleControlRoomMono'; payload?: undefined }
    | { type: 'toggleControlRoomDim'; payload?: undefined }
    | { type: 'switchMonitor'; payload: { monitorId: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        controlRoom: ControlRoomAppAction;
    }
}
