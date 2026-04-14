import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DragEvent } from 'react';
import { handleSamplerFileDrop } from '../handleFileDrop';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn(),
    loadSampleFromPath: vi.fn(),
    switchSamplerMode: vi.fn(),
    samplerStore: { value: null as any },
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
}));

vi.mock('../loadSample', () => ({
    loadSampleFromPath: mocks.loadSampleFromPath,
}));

vi.mock('../setSamplerMode', () => ({
    switchSamplerMode: mocks.switchSamplerMode,
}));

vi.mock('../../../stores/samplerStore', () => ({
    samplerStore: mocks.samplerStore,
}));

describe('handleSamplerFileDrop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not load when not running in Tauri', async () => {
        mocks.isTauri.mockReturnValue(false);
        mocks.samplerStore.value = null;

        const file = new File([], 'clip.wav', { type: 'audio/wav' });
        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            dataTransfer: { files: [file] },
        } as unknown as DragEvent;

        await handleSamplerFileDrop(event);

        expect(mocks.loadSampleFromPath).not.toHaveBeenCalled();
    });
});
