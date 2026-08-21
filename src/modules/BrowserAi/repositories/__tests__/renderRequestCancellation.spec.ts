import { afterEach, describe, expect, it } from 'vitest';

import { renderRequestCancellation } from '../renderRequestCancellation';

const leases: Array<{ dispose: () => void }> = [];

afterEach(() => {
    for (const lease of leases.splice(0)) {
        lease.dispose();
    }
});

describe('renderRequestCancellation', () => {
    it('requires the exact phrase and request pair without disturbing a sibling owner', () => {
        const first = renderRequestCancellation.own('phrase-a', 'request-a');
        const sibling = renderRequestCancellation.own('phrase-b', 'request-b');
        leases.push(first, sibling);

        expect(renderRequestCancellation.cancel('wrong-phrase', 'request-a')).toBe(false);
        expect(first.signal.aborted).toBe(false);
        expect(sibling.signal.aborted).toBe(false);

        expect(renderRequestCancellation.cancel('phrase-a', 'request-a')).toBe(true);
        expect(first.signal.aborted).toBe(true);
        expect(sibling.signal.aborted).toBe(false);
    });

    it('removes the exact owner when its lease is disposed', () => {
        const lease = renderRequestCancellation.own('phrase-a', 'request-a');
        leases.push(lease);

        lease.dispose();

        expect(renderRequestCancellation.cancel('phrase-a', 'request-a')).toBe(false);
    });
});
