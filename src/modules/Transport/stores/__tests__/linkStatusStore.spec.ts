import { describe, it, expect, beforeEach } from 'vitest';

import { linkStatusStore, defaultLinkStatus, getLinkStatusSnapshot } from '../linkStatusStore';

describe('linkStatusStore', () => {
    beforeEach(() => {
        linkStatusStore.set(defaultLinkStatus);
    });

    it('should have initial state', () => {
        expect(linkStatusStore.value?.enabled).toBe(false);
        expect(linkStatusStore.value?.tempo).toBe(120);
    });

    it('should provide getLinkStatusSnapshot', () => {
        expect(getLinkStatusSnapshot()).toBe(false);
        linkStatusStore.update((state) => ({ ...state!, enabled: true }));
        expect(getLinkStatusSnapshot()).toBe(true);
    });
});
