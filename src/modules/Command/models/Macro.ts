import { type AppAction } from '../useCases/commandQueries';

export type Macro = {
    id: string;
    name: string;
    actions: AppAction[];
    createdAt: number;
};
