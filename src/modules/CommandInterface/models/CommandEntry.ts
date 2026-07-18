/** Data shape shared by command-palette entries. Callable actions are supplied by the use-case layer. */

import { type AppAction } from '#/utils/handlerContract';

export type CommandEntry<Action = AppAction> = {
    id: string;
    label: string;
    description: string;
    category: string;
    shortcut?: string;
    action: Action;
};
