import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateCloudToolCalls } from '../cloudInference/generateCloudToolCalls';
import * as keyManagement from '../keyManagement';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

vi.mock('../keyManagement', () => ({
    getCloudClient: vi.fn(),
}));

describe('generateCloudToolCalls', () => {
    beforeEach(() => {
        vi.mocked(keyManagement.getCloudClient).mockReset();
        vi.clearAllMocks();
    });

    it('should throw when cloud client is not configured', async () => {
        vi.mocked(keyManagement.getCloudClient).mockReturnValue(null);
        await expect(generateCloudToolCalls('state', 'hi')).rejects.toThrow(/Cloud AI not configured/);
    });

    it('should map tool_use blocks from Claude response', async () => {
        vi.mocked(keyManagement.getCloudClient).mockReturnValue({
            messages: {
                create: vi.fn().mockResolvedValue({
                    content: [
                        {
                            type: 'tool_use',
                            name: 'setTempo',
                            input: { bpm: 120 },
                        },
                    ],
                }),
            },
        } as unknown as ReturnType<typeof keyManagement.getCloudClient>);

        const results = await generateCloudToolCalls('{}', 'faster');

        expect(results).toEqual([{ name: 'setTempo', arguments: { bpm: 120 } }]);
        expect(mockLogger.info).toHaveBeenCalled();
    });
});
