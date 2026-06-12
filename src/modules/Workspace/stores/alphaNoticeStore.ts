import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

const storage = createLocalStorage<boolean>('sourdaw-alpha-notice-dismissed');

export const alphaNoticeStore = createStore<boolean>({
    storage,
    initialData: false,
});
