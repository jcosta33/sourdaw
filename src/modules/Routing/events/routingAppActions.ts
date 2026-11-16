export type RoutingAppAction = { type: 'toggleNodeView'; payload?: undefined };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        routing: RoutingAppAction;
    }
}
