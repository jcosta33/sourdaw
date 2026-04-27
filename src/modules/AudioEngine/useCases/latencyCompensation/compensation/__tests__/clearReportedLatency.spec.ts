import { describe, it, expect, beforeEach } from 'vitest';

import { clearReportedLatency } from '../clearReportedLatency';
import { externalLatencyRegistry } from '../externalLatencyRegistry';

describe('clearReportedLatency', () => {
    beforeEach(() => {
        externalLatencyRegistry.clear();
    });

    it('should remove a device entry from the external latency registry', () => {
        externalLatencyRegistry.set('custom-io', 4);

        clearReportedLatency('custom-io');

        expect(externalLatencyRegistry.get('custom-io')).toBeUndefined();
    });
});
