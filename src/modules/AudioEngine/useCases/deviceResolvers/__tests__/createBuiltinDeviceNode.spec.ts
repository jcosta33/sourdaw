import { describe, expect, it } from 'vitest';

import { asBaseAudioContext, createMockAudioContext } from '../../../../../helpers/__tests__/audioContext.mock';
import { createBuiltinDeviceNode } from '../createBuiltinDeviceNode';

describe('createBuiltinDeviceNode', () => {
    it('returns null for an unknown built-in device type', () => {
        const context = createMockAudioContext();

        const result = createBuiltinDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'missing-device',
        });

        expect(result).toBeNull();
    });

    it('resolves a built-in gain device through the use-case boundary', () => {
        const context = createMockAudioContext();

        const result = createBuiltinDeviceNode({
            context: asBaseAudioContext(context),
            deviceType: 'builtin-gain',
        });

        expect(result).not.toBeNull();
        expect(result?.inputNode).toBe(result?.outputNode);
        expect(result?.nodes).toHaveLength(1);
        expect(context.createGain).toHaveBeenCalledTimes(1);
    });
});
