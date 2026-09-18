import { engineFallbackNoticeStore } from '../stores/engineFallbackNoticeStore';

export function dismissEngineFallbackNotice(): void {
    engineFallbackNoticeStore.trySet(true);
}
