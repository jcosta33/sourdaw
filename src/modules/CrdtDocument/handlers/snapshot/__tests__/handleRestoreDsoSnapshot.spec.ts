import { describe, it, expect, vi, beforeEach } from 'vitest';

import { restoreSnapshot } from '../../../useCases/restoreSnapshot';
import { handleRestoreDsoSnapshot } from '../handleRestoreDsoSnapshot';

vi.mock('../../../useCases/restoreSnapshot', () => ({ restoreSnapshot: vi.fn() }));

describe('handleRestoreDsoSnapshot', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should delegate to restoreSnapshot', () => {
        const bundle = new Map([['created', { state: 'present' as const, bytes: new Uint8Array([1]) }]]);
        void handleRestoreDsoSnapshot.execute({ type: 'restoreDsoSnapshot', payload: { bundle } });
        expect(restoreSnapshot).toHaveBeenCalledWith(bundle);
    });
});
