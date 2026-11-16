export type PunchRecordingAppAction = { type: 'togglePunchRecording'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        punchRecording: PunchRecordingAppAction;
    }
}
