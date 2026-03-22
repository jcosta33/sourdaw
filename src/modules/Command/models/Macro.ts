import { type AppAction } from './AppAction';

export type Macro = {
    id: string;
    name: string;
    actions: AppAction[];
    createdAt: number;
};
