import { createStore } from '#/infra/store/createStore';

export const tempoProjectRevisionStore = createStore<number>({ initialData: 0 });
