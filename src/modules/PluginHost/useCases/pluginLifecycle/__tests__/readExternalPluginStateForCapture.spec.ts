import { beforeEach, describe, expect, it, vi } from 'vitest';

import { bytesToBase64 } from '#/utils/base64';

import { externalPluginActivationTasks } from '../externalPluginActivationTasks';
import { externalPluginRestoreFailures } from '../externalPluginRestoreFailures';
import { externalPluginStateCaptureAuthority } from '../externalPluginStateCaptureAuthority';
import { loadedExternalInstances } from '../loadedExternalInstances';
import { readExternalPluginStateForCapture } from '../readExternalPluginStateForCapture';

const mocks = vi.hoisted(() => ({
    getPluginState: vi.fn<(instanceId: string) => Promise<Uint8Array>>(),
}));

vi.mock('../../../repositories/pluginBridge/getPluginState', () => ({ getPluginState: mocks.getPluginState }));

const INSTANCE_ID = 'instance-capture';

describe('readExternalPluginStateForCapture', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        loadedExternalInstances.clear();
        externalPluginActivationTasks.clear();
        externalPluginRestoreFailures.clear();
        externalPluginStateCaptureAuthority.invalidateAll();
        loadedExternalInstances.add(INSTANCE_ID);
        mocks.getPluginState.mockResolvedValue(new Uint8Array([1, 2, 3]));
    });

    it('returns stable host bytes with a live per-instance authority receipt', async () => {
        const result = await readExternalPluginStateForCapture(INSTANCE_ID);

        expect(result.status).toBe('captured');
        if (result.status !== 'captured') {
            throw new Error('expected captured result');
        }
        expect(result.stateChunk).toBe(bytesToBase64(new Uint8Array([1, 2, 3])));
        expect(result.authorityToken).toBe(externalPluginStateCaptureAuthority.current(INSTANCE_ID));
        expect(result.isCurrent()).toBe(true);

        const nextResult = await readExternalPluginStateForCapture(INSTANCE_ID);
        expect(nextResult.status).toBe('captured');
        if (nextResult.status !== 'captured') {
            throw new Error('expected captured result');
        }
        expect(nextResult.authorityToken).toBe(result.authorityToken);

        externalPluginStateCaptureAuthority.invalidate(INSTANCE_ID);
        expect(result.isCurrent()).toBe(false);
    });

    it('preserves without reading while activation or failed restore makes host state non-authoritative', async () => {
        externalPluginActivationTasks.set(INSTANCE_ID, Promise.resolve({ status: 'active' }));
        await expect(readExternalPluginStateForCapture(INSTANCE_ID)).resolves.toEqual({
            status: 'preserve',
            reason: 'restore-pending',
        });

        externalPluginActivationTasks.clear();
        externalPluginRestoreFailures.add(INSTANCE_ID);
        await expect(readExternalPluginStateForCapture(INSTANCE_ID)).resolves.toEqual({
            status: 'preserve',
            reason: 'restore-failed',
        });
        expect(mocks.getPluginState).not.toHaveBeenCalled();
    });

    it('preserves absent, empty, and failed reads without issuing authority', async () => {
        loadedExternalInstances.clear();
        await expect(readExternalPluginStateForCapture(INSTANCE_ID)).resolves.toEqual({
            status: 'preserve',
            reason: 'not-loaded',
        });

        loadedExternalInstances.add(INSTANCE_ID);
        mocks.getPluginState.mockResolvedValueOnce(new Uint8Array());
        await expect(readExternalPluginStateForCapture(INSTANCE_ID)).resolves.toEqual({
            status: 'preserve',
            reason: 'empty',
        });

        mocks.getPluginState.mockRejectedValueOnce(new Error('read failed'));
        await expect(readExternalPluginStateForCapture(INSTANCE_ID)).resolves.toEqual({
            status: 'preserve',
            reason: 'read-failed',
        });
    });

    it('returns stale with the current warning token when lifecycle authority changes during the host read', async () => {
        const pending = Promise.withResolvers<Uint8Array>();
        mocks.getPluginState.mockReturnValueOnce(pending.promise);

        const read = readExternalPluginStateForCapture(INSTANCE_ID);
        await vi.waitFor(() => expect(mocks.getPluginState).toHaveBeenCalledOnce());
        externalPluginStateCaptureAuthority.invalidate(INSTANCE_ID);
        const currentToken = externalPluginStateCaptureAuthority.current(INSTANCE_ID);
        pending.resolve(new Uint8Array([4, 5, 6]));

        await expect(read).resolves.toEqual({ status: 'stale', authorityToken: currentToken });
    });
});
