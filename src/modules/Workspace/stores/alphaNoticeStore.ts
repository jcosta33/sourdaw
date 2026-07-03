import { createStore } from '#/infra/store/createStore';
import { createLocalStorage } from '#/infra/store/storage/createLocalStorage';

const storage = createLocalStorage<boolean>('sourdaw-alpha-notice-dismissed');

function validateStoredAlphaNoticeDismissed(stored: unknown): boolean {
    if (typeof stored === 'boolean') {
        return stored;
    }

    return false;
}

export const alphaNoticeStore = createStore<boolean>({
    storage,
    initialData: false,
    sanitize: validateStoredAlphaNoticeDismissed,
});
