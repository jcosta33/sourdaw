export type BrowserAiAppAction =
    { type: 'loadRaveModel'; payload: { modelId: string } } | { type: 'setRaveBlend'; payload: { blend: number } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        browserAi: BrowserAiAppAction;
    }
}
