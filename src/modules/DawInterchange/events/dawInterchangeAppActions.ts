export type DawInterchangeAppAction =
    { type: 'exportDawProject'; payload?: undefined } | { type: 'importDawProject'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        dawInterchange: DawInterchangeAppAction;
    }
}
