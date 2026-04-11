import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { generateCloudToolCalls } from './cloudInference/generateCloudToolCalls';
import { type Logger } from '#/helpers/Logger/Logger';
import * as keyManagement from './keyManagement';

vi.mock('./keyManagement', () => ({
    getCloudClient: vi.fn(),
}));

describe('generateCloudToolCalls', () => {
    beforeEach(() => {
        vi.mocked(keyManagement.getCloudClient).mockReset();
    });

    it('should throw when cloud client is not configured', async () => {
        vi.mocked(keyManagement.getCloudClient).mockReturnValue(null);

        const logger = createMock<Logger>();
        injectDependencies(generateCloudToolCalls, { logger });

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

        const logger = createMock<Logger>();
        injectDependencies(generateCloudToolCalls, { logger });

        const results = await generateCloudToolCalls('{}', 'faster');

        expect(results).toEqual([{ name: 'setTempo', arguments: { bpm: 120 } }]);
        expect(logger.info).toHaveBeenCalled();
    });
});
