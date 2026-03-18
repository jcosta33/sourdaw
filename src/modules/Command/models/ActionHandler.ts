import { type AppAction, type AppActionType } from './AppAction';

export type ActionResult = {
    label: string;
    inverseAction?: AppAction | null;
};

export type ActionHandler<T extends AppAction = AppAction> = {
    execute: (action: T) => void | Promise<void>;
    describe: (action: T) => ActionResult;
    undoable: boolean;
};

export type ActionHandlerMap = {
    [K in AppActionType]: ActionHandler<Extract<AppAction, { type: K }>>;
};
