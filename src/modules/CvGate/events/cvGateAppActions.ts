export type CvGateAppAction =
    | { type: 'addCvOutput'; payload: { name: string; channel: number; type: string } }
    | { type: 'removeCvOutput'; payload: { outputId: string } };

declare module '#/utils/handlerContract' {
    // eslint-disable-next-line @typescript-eslint/consistent-type-definitions -- declaration-merging target: a type alias cannot merge
    interface AppActionRegistry {
        cvGate: CvGateAppAction;
    }
}
