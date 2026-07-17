import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
    projectCrdtToStores: vi.fn(),
    onChange: vi.fn(),
}));

vi.mock('../../../repositories/automergeRepository', () => ({
    automergeRepository: { onChange: mocks.onChange },
}));

vi.mock('../projectProjection', () => ({
    projectCrdtToStores: mocks.projectCrdtToStores,
}));

import { setupProjectionBridge } from '../setupProjectionBridge';

describe('setupProjectionBridge docId hint', () => {
    beforeEach(() => vi.clearAllMocks());

    function subscribeAndGetCallback(): (docId?: string) => void {
        setupProjectionBridge();
        expect(mocks.onChange).toHaveBeenCalledTimes(1);
        const firstCall = mocks.onChange.mock.calls[0];
        if (!firstCall) {
            throw new Error('Expected onChange to receive a subscription callback');
        }
        return firstCall[0] as (docId?: string) => void;
    }

    it('re-hydrates on a root-doc change', () => {
        const onChangeCallback = subscribeAndGetCallback();
        onChangeCallback('root');
        expect(mocks.projectCrdtToStores).toHaveBeenCalledTimes(1);
    });

    it('re-hydrates on a bulk op (undefined hint)', () => {
        const onChangeCallback = subscribeAndGetCallback();
        onChangeCallback(undefined);
        expect(mocks.projectCrdtToStores).toHaveBeenCalledTimes(1);
    });

    it('skips the full re-hydrate for a non-root doc (branch / __branches__) change', () => {
        const onChangeCallback = subscribeAndGetCallback();
        onChangeCallback('branch_abc123');
        onChangeCallback('__branches__');
        expect(mocks.projectCrdtToStores).not.toHaveBeenCalled();
    });
});
