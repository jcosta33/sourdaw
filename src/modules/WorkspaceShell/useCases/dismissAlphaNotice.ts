import { alphaNoticeStore } from '../stores/alphaNoticeStore';

export function dismissAlphaNotice(): void {
    alphaNoticeStore.trySet(true);
}
