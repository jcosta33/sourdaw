import { describe, expect, it } from 'vitest';

import { getSidechainTargetCapability } from '../getSidechainTargetCapability';

describe('getSidechainTargetCapability', () => {
    it('projects the canonical built-in compressor sidechain input', () => {
        expect(getSidechainTargetCapability('builtin-sidechain-compressor')).toEqual({
            targetParameterId: 'threshold',
        });
    });

    it('does not infer sidechain support from arbitrary compressor names', () => {
        expect(getSidechainTargetCapability('third-party-bass-compressor')).toBeNull();
        expect(getSidechainTargetCapability('builtin-eq')).toBeNull();
    });
});
