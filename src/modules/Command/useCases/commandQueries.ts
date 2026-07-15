import { type AppAction } from '../models/AppAction';

/** Return shape of `ActionHandler.describe` — exported for `#/utils/createHandler`. */
export type HandlerDescribeResult = {
    label: string;
    inverseAction?: AppAction | null;
};

export type ActionHandler<Action extends AppAction = AppAction> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => HandlerDescribeResult;
    undoable: boolean;
};

export type { AppAction } from '../models/AppAction';
