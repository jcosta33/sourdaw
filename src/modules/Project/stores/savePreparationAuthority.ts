import { type AppAction } from '#/utils/handlerContract';

import { type ProjectStoreState } from './projectStore';

export type SavePreparationIntent = NonNullable<Extract<AppAction, { type: 'saveProject' }>['payload']>;

type SavePreparationRequest = {
    readonly readProject: () => ProjectStoreState;
    initializedLegacyArrangement: boolean;
};

export const authorizedPreparations = new WeakMap<SavePreparationIntent, SavePreparationRequest>();

/** A retry is safe only when the caller still owns the same active project. */
export class ProjectSavePreparationStaleError extends Error {
    constructor() {
        super('Project Save inputs changed during preparation');
        this.name = 'ProjectSavePreparationStaleError';
    }
}
