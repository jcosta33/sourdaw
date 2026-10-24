import { createStore } from '#/infra/store/createStore';

/** Current native drag source. This is disposable UI state, never project data. */
export const modulationDragPreviewStore = createStore<{ modulatorId: string | null }>({
    initialData: { modulatorId: null },
});
