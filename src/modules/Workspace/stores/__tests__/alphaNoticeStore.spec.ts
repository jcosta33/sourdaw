import { stringify } from 'superjson';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORAGE_KEY = 'sourdaw-alpha-notice-dismissed';

async function hydrate_alpha_notice_value(): Promise<boolean | null> {
    vi.resetModules();
    const { alphaNoticeStore } = await import('../alphaNoticeStore');
    return alphaNoticeStore.value;
}

describe('alphaNoticeStore hydration', () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        window.localStorage.clear();
    });

    it('should preserve valid stored boolean true and false values', async () => {
        window.localStorage.setItem(STORAGE_KEY, stringify(true));
        expect(await hydrate_alpha_notice_value()).toBe(true);

        window.localStorage.setItem(STORAGE_KEY, stringify(false));
        expect(await hydrate_alpha_notice_value()).toBe(false);
    });

    it('should hydrate missing storage to false', async () => {
        expect(await hydrate_alpha_notice_value()).toBe(false);
    });

    it('should hydrate malformed raw localStorage text to false', async () => {
        window.localStorage.setItem(STORAGE_KEY, 'not-superjson');

        expect(await hydrate_alpha_notice_value()).toBe(false);
    });

    it.each([
        ['string', stringify('yes')],
        ['number', stringify(1)],
        ['object', stringify({ dismissed: true })],
    ])('should hydrate parsed non-boolean %s values to false', async (_label, serialized_value) => {
        window.localStorage.setItem(STORAGE_KEY, serialized_value);

        expect(await hydrate_alpha_notice_value()).toBe(false);
    });
});
