import { createStore } from '#/infra/store/createStore';

export const grooveTemplateProjectRevisionStore = createStore<number>({ initialData: 0 });
