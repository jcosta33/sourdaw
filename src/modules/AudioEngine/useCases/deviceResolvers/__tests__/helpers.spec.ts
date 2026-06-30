import { describe, it, expect } from 'vitest';

import { createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { createBuiltinDeviceNode } from '../createBuiltinDeviceNode';

describe('createBuiltinDeviceNode', () => {
    it('should return null for an unknown built-in device type', () => {
        const context = createMockAudioContext();

        const result = createBuiltinDeviceNode({
            context,
            deviceType: 'missing-device',
        });

        expect(result).toBeNull();
    });
});
