import { type AppAction } from '#/utils/handlerContract';

export type Macro = {
    id: string;
    name: string;
    actions: AppAction[];
    createdAt: number;
};
