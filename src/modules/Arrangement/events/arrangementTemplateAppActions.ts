export type ArrangementTemplateAppAction =
    | { type: 'saveTrackTemplate'; payload: { trackId: string; name: string; category: string } }
    | { type: 'loadTrackTemplate'; payload: { templateId: string } }
    | { type: 'deleteTrackTemplate'; payload: { templateId: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        arrangementTemplate: ArrangementTemplateAppAction;
    }
}
