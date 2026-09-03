import { describe, expect, it } from 'vitest';

import {
    appendUnitShardExclusions,
    DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB,
    DEVICE_WRITE_BOUNDARY_CENSUS_SPEC,
} from '../vitestUnitShardExclusions.ts';

describe('appendUnitShardExclusions', () => {
    it('leaves non-sharded invocations unchanged', () => {
        const args = ['scripts/__tests__/vitestZeroTestReport.spec.ts'] as const;
        expect(appendUnitShardExclusions(args)).toEqual(args);
    });

    it('appends the census exclude glob when sharding', () => {
        expect(appendUnitShardExclusions(['--shard=2/4'])).toEqual([
            '--shard=2/4',
            '--exclude',
            DEVICE_WRITE_BOUNDARY_CENSUS_EXCLUDE_GLOB,
        ]);
    });

    it('does not duplicate the exclude when the census spec is run directly', () => {
        expect(appendUnitShardExclusions([DEVICE_WRITE_BOUNDARY_CENSUS_SPEC])).toEqual([
            DEVICE_WRITE_BOUNDARY_CENSUS_SPEC,
        ]);
    });
});
