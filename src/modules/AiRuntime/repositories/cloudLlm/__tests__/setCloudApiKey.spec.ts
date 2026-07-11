import { beforeEach, describe, expect, it, vi } from 'vitest';

import { clearCloudApiKey } from '../clearCloudApiKey';
import { getCloudClient } from '../getCloudClient';
import { isCloudAvailable } from '../isCloudAvailable';
import { registerCloudStreamController } from '../registerCloudStreamController';
import { setCloudApiKey } from '../setCloudApiKey';

type CloudClientConfig = {
    apiKey: string;
    dangerouslyAllowBrowser: boolean;
};

const { create_client, mockLogger } = vi.hoisted(() => ({
    create_client: vi.fn<(config: CloudClientConfig) => object>(),
    mockLogger: {
        info: vi.fn<(...args: unknown[]) => void>(),
        warn: vi.fn<(...args: unknown[]) => void>(),
        error: vi.fn<(...args: unknown[]) => void>(),
        debug: vi.fn<(...args: unknown[]) => void>(),
    },
}));

vi.mock('@anthropic-ai/sdk', () => ({
    default: function MockAnthropic(config: CloudClientConfig): object {
        return create_client(config);
    },
}));

vi.mock('#/infra/logger/appLogger', () => ({ logger: mockLogger }));

describe('setCloudApiKey', () => {
    beforeEach(() => {
        clearCloudApiKey();
        vi.resetAllMocks();
    });

    it('should create the cloud client, mark cloud available, and log without the key', () => {
        const client = { id: 'first-client' };
        create_client.mockReturnValue(client);

        setCloudApiKey('sk-test-key');

        expect(getCloudClient()).toBe(client);
        expect(isCloudAvailable()).toBe(true);
        expect(mockLogger.info).toHaveBeenCalledWith('[Cloud AI] API key set');
        expect(mockLogger.info).not.toHaveBeenCalledWith(expect.stringContaining('sk-test-key'));
    });

    it('should revoke streams from the old client when credentials rotate successfully', () => {
        const old_client = { id: 'old-client' };
        const new_client = { id: 'new-client' };
        create_client.mockReturnValueOnce(old_client).mockReturnValueOnce(new_client);
        setCloudApiKey('sk-old-key');
        const old_stream = registerCloudStreamController(new AbortController());

        setCloudApiKey('sk-new-key');

        expect(old_stream.signal.aborted).toBe(true);
        expect(getCloudClient()).toBe(new_client);
        expect(isCloudAvailable()).toBe(true);
    });

    it('should preserve the old client, availability, and controllers when client construction fails', () => {
        const old_client = { id: 'old-client' };
        create_client.mockReturnValueOnce(old_client);
        setCloudApiKey('sk-old-key');
        const old_stream = registerCloudStreamController(new AbortController());
        create_client.mockImplementationOnce(() => {
            expect(old_stream.signal.aborted).toBe(false);
            throw new Error('client construction failed');
        });

        expect(() => setCloudApiKey('sk-rejected-key')).toThrow('client construction failed');

        expect(getCloudClient()).toBe(old_client);
        expect(isCloudAvailable()).toBe(true);
        expect(old_stream.signal.aborted).toBe(false);

        clearCloudApiKey();
        expect(old_stream.signal.aborted).toBe(true);
    });

    it('should let a re-entrant clear supersede an in-progress credential rotation', () => {
        const old_client = { id: 'old-client' };
        const rejected_client = { id: 'rejected-client' };
        create_client.mockReturnValueOnce(old_client).mockReturnValueOnce(rejected_client);
        setCloudApiKey('sk-old-key');
        const old_stream = registerCloudStreamController(new AbortController());
        old_stream.signal.addEventListener('abort', () => clearCloudApiKey(), { once: true });

        expect(() => setCloudApiKey('sk-rejected-key')).toThrow('Cloud credential replacement was superseded');

        expect(getCloudClient()).toBeNull();
        expect(isCloudAvailable()).toBe(false);
        expect(mockLogger.info).toHaveBeenCalledTimes(1);
    });

    it('should never log the supplied key or Anthropic client configuration on any logger method', () => {
        const api_key = 'sk-sensitive-key';
        const client = { id: 'secret-free-client' };
        const client_config = { apiKey: api_key, dangerouslyAllowBrowser: true };
        create_client.mockReturnValue(client);

        setCloudApiKey(api_key);

        expect(create_client).toHaveBeenCalledWith(client_config);
        const all_log_calls = [
            ...mockLogger.info.mock.calls,
            ...mockLogger.warn.mock.calls,
            ...mockLogger.error.mock.calls,
            ...mockLogger.debug.mock.calls,
        ];
        expect(all_log_calls).toEqual([['[Cloud AI] API key set']]);

        const serialized_log_calls = JSON.stringify(all_log_calls);
        expect(serialized_log_calls).not.toContain(api_key);
        expect(serialized_log_calls).not.toContain('apiKey');
        expect(serialized_log_calls).not.toContain('dangerouslyAllowBrowser');
    });
});
