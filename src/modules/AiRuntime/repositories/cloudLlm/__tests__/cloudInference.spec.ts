import { describe, it, expect, vi, beforeEach } from 'vitest';

import { generateCloudToolCalls } from '../cloudInference/generateCloudToolCalls';
import { getCloudClient } from '../getCloudClient';
import { getCloudProviderRuntime } from '../getCloudProviderRuntime';

const { mockLogger } = vi.hoisted(() => ({
    mockLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
    },
}));
vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

vi.mock('../getCloudClient', () => ({
    getCloudClient: vi.fn(),
}));

vi.mock('../getCloudProviderRuntime', () => ({
    getCloudProviderRuntime: vi.fn(),
}));

describe('generateCloudToolCalls', () => {
    beforeEach(() => {
        vi.mocked(getCloudClient).mockReset();
        vi.mocked(getCloudProviderRuntime).mockReset();
        vi.clearAllMocks();
    });

    it('should throw when cloud client is not configured', async () => {
        vi.mocked(getCloudClient).mockReturnValue(null);
        vi.mocked(getCloudProviderRuntime).mockReturnValue(null);
        await expect(generateCloudToolCalls('state', 'hi')).rejects.toThrow(/Cloud AI not configured/);
    });

    it('should map tool_use blocks from Claude response', async () => {
        const client = {
            messages: {
                create: vi.fn().mockResolvedValue({
                    content: [
                        {
                            type: 'tool_use',
                            name: 'setTempo',
                            input: { bpm: 120 },
                        },
                    ],
                    stop_reason: 'tool_use',
                }),
            },
        } as unknown as NonNullable<ReturnType<typeof getCloudClient>>;
        vi.mocked(getCloudClient).mockReturnValue(client);
        vi.mocked(getCloudProviderRuntime).mockReturnValue({
            provider: 'anthropic',
            api_key: 'test-key',
            model: 'test-model',
            client,
        });

        const results = await generateCloudToolCalls('{}', 'faster');

        expect(results).toEqual([{ name: 'setTempo', arguments: { bpm: 120 } }]);
        expect(mockLogger.info).toHaveBeenCalled();
    });
});
