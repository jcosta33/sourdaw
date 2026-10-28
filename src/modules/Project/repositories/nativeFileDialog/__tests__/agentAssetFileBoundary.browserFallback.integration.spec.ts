import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { agentAssetFileBoundary } from '../../../useCases/agentAssetFileBoundary';

import type { AgentAssetSagaReceipt, AgentWorkOwner } from '../../agentAssetSaga/agentAssetSagaWire';

const desktop = vi.hoisted(() => ({
    isDesktopRuntime: vi.fn(),
    desktopOpenDialog: vi.fn(),
    desktopSaveDialog: vi.fn(),
    desktopInvoke: vi.fn(),
    readFileBytes: vi.fn(),
}));

vi.mock('#/utils/desktopBridge', () => desktop);
vi.mock('#/utils/desktopRuntime', () => ({ isDesktopRuntime: desktop.isDesktopRuntime }));

const owner: AgentWorkOwner = { runId: 'run', workId: 'work', leaseId: 'lease', cancellationGeneration: 0 };
const nativeReceipt: AgentAssetSagaReceipt = {
    sagaId: 'asset-saga-11111111-1111-4111-8111-111111111111',
    owner,
    operation: 'register-handle',
    state: 'committed',
    compensation: 'not-needed',
    handleId: 'asset-handle-22222222-2222-4222-8222-222222222222',
    assetId: null,
    contentHash: null,
    metadata: null,
    failure: null,
    message: null,
    finalizeOwner: null,
    cleanupOwner: null,
};

describe('native handles after a browser file fallback', () => {
    const inputs: HTMLInputElement[] = [];

    beforeEach(() => {
        vi.resetAllMocks();
        inputs.length = 0;
        desktop.isDesktopRuntime.mockReturnValue(true);
        desktop.desktopOpenDialog.mockRejectedValue(new Error('native grant rejected for /private/selected.wav'));
        desktop.desktopInvoke.mockImplementation(() => {
            throw new Error('Browser Files must not reach native handle registration');
        });
        desktop.readFileBytes.mockImplementation(() => {
            throw new Error('Browser Files must not reach native byte reading');
        });
    });

    afterEach(() => {
        for (const input of inputs) {
            input.dispatchEvent(new Event('cancel'));
        }
        vi.restoreAllMocks();
    });

    it('refuses real browser-selected Files before native registration without exposing their authority', async () => {
        const file = new File([new Uint8Array([1, 255, 3])], 'selected.wav', { type: 'audio/wav' });
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            inputs.push(this);
            Object.defineProperty(this, 'files', { configurable: true, value: [file] });
            this.dispatchEvent(new Event('change'));
        });

        const result = await agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read', multiple: true });

        expect(result).toEqual({ status: 'refused', reason: 'native-file-grant-unavailable' });
        expect(JSON.stringify(result)).not.toContain('selected.wav');
        expect(JSON.stringify(result)).not.toContain('/private/');
        expect(JSON.stringify(result)).not.toContain('native grant rejected');
        expect(desktop.desktopInvoke).not.toHaveBeenCalled();
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it('keeps browser cancellation after grant failure distinct from native cancellation', async () => {
        vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function (this: HTMLInputElement) {
            inputs.push(this);
            this.dispatchEvent(new Event('cancel'));
        });

        await expect(agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read' })).resolves.toEqual({
            status: 'refused',
            reason: 'native-file-grant-unavailable',
        });
        desktop.desktopOpenDialog.mockResolvedValue(null);
        await expect(agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read' })).resolves.toEqual({
            status: 'refused',
            reason: 'no-selection',
        });

        expect(inputs).toHaveLength(1);
        expect(desktop.desktopInvoke).not.toHaveBeenCalled();
        expect(desktop.readFileBytes).not.toHaveBeenCalled();
    });

    it('preserves granted native paths through the actual registration consumer', async () => {
        desktop.desktopOpenDialog.mockResolvedValue(['/granted/native.wav']);
        desktop.desktopInvoke.mockResolvedValue(nativeReceipt);
        const click = vi.spyOn(HTMLInputElement.prototype, 'click');

        const result = await agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read' });

        expect(desktop.desktopInvoke.mock.calls).toEqual([
            ['agent_asset_register_handle', { path: '/granted/native.wav', mode: 'read', owner }],
        ]);
        expect(result).toEqual({
            status: 'granted',
            handles: [{ handleId: nativeReceipt.handleId, receipt: nativeReceipt }],
            failures: [],
        });
        expect(JSON.stringify(result)).not.toContain('/granted/native.wav');
        expect(click).not.toHaveBeenCalled();
        expect(desktop.desktopSaveDialog).not.toHaveBeenCalled();
    });

    it('does not open either picker when the native runtime is absent', async () => {
        desktop.isDesktopRuntime.mockReturnValue(false);

        await expect(agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read' })).resolves.toEqual({
            status: 'refused',
            reason: 'native-runtime-unavailable',
        });

        expect(desktop.desktopOpenDialog).not.toHaveBeenCalled();
        expect(desktop.desktopSaveDialog).not.toHaveBeenCalled();
        expect(desktop.desktopInvoke).not.toHaveBeenCalled();
    });

    it('keeps read-write selection on the native save-grant route', async () => {
        desktop.desktopSaveDialog.mockResolvedValue('/exports/mix.wav');
        desktop.desktopInvoke.mockResolvedValue(nativeReceipt);
        const click = vi.spyOn(HTMLInputElement.prototype, 'click');

        const result = await agentAssetFileBoundary.pickAndRegister({
            owner,
            mode: 'read-write',
            suggestedName: '/private/mix.wav',
        });

        expect(result.status).toBe('granted');
        expect(desktop.desktopSaveDialog).toHaveBeenCalledWith({ defaultPath: 'mix.wav', filters: undefined });
        expect(desktop.desktopInvoke.mock.calls).toEqual([
            ['agent_asset_register_handle', { path: '/exports/mix.wav', mode: 'read-write', owner }],
        ]);
        expect(desktop.desktopOpenDialog).not.toHaveBeenCalled();
        expect(click).not.toHaveBeenCalled();
    });

    it('keeps native save cancellation as no selection', async () => {
        desktop.desktopSaveDialog.mockResolvedValue(null);

        await expect(agentAssetFileBoundary.pickAndRegister({ owner, mode: 'read-write' })).resolves.toEqual({
            status: 'refused',
            reason: 'no-selection',
        });

        expect(desktop.desktopOpenDialog).not.toHaveBeenCalled();
        expect(desktop.desktopInvoke).not.toHaveBeenCalled();
    });
});
