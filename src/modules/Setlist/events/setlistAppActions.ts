export type SetlistAppAction =
    { type: 'nextSetlistItem'; payload?: undefined } | { type: 'previousSetlistItem'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        setlist: SetlistAppAction;
    }
}
