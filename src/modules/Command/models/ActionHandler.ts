import { type AppAction } from './AppAction';

export type ActionResult = {
    label: string;
    inverseAction?: AppAction | null;
};

export type ActionHandler<Action extends AppAction = AppAction> = {
    execute: (action: Action) => void | Promise<void>;
    describe: (action: Action) => ActionResult;
    undoable: boolean;
};
