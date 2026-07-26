import { describe, it, expect, vi } from 'vitest';

import { processAudioIPC as processAudioIPCRepository } from '../../../repositories/pluginBridge/processAudioIPC';
import { processAudioIPC } from '../processAudioIPC';

vi.mock('../../../repositories/pluginBridge/processAudioIPC', () => ({
    processAudioIPC: vi.fn(),
}));

describe('processAudioIPC', () => {
    it('should delegate native plugin audio processing to the Plugin repository boundary', async () => {
        const processedBytes = new Uint8Array([4, 5, 6]);
        vi.mocked(processAudioIPCRepository).mockResolvedValue(processedBytes);

        const audioBytes = new Uint8Array([1, 2, 3]);
        const result = await processAudioIPC({ instanceId: 'instance-17', audioBytes });

        expect(processAudioIPCRepository).toHaveBeenCalledWith({ instanceId: 'instance-17', audioBytes });
        expect(result).toBe(processedBytes);
    });
});
