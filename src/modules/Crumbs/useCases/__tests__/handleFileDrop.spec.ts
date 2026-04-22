import type { DragEvent } from 'react';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCrumbsFileDrop } from '../handleFileDrop';

const mocks = vi.hoisted(() => ({
    isTauri: vi.fn<() => boolean>(),
    loadSampleFromPath: vi.fn<() => Promise<void>>(),
    switchCrumbsMode: vi.fn<() => void>(),
    crumbsStore: { value: null as unknown as Record<string, import('../../stores/crumbsStore').CrumbsState> | null },
    logger: { warn: vi.fn<() => void>() },
}));

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: mocks.isTauri,
}));

vi.mock('../loadSample', () => ({
    loadSampleFromPath: mocks.loadSampleFromPath,
}));

vi.mock('../setCrumbsMode', () => ({
    switchCrumbsMode: mocks.switchCrumbsMode,
}));

vi.mock('../../stores/crumbsStore', () => ({
    crumbsStore: mocks.crumbsStore,
}));

vi.mock('#/infra/logger/appLogger', () => ({
    logger: mocks.logger,
}));

describe('handleCrumbsFileDrop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('does not load when not running in Tauri', async () => {
        mocks.isTauri.mockReturnValue(false);
        mocks.crumbsStore.value = null;

        const file = new File([], 'clip.wav', { type: 'audio/wav' });
        const event = {
            preventDefault: vi.fn<() => void>(),
            stopPropagation: vi.fn<() => void>(),
            dataTransfer: { files: [file] as unknown as FileList },
        } as unknown as DragEvent;

        await handleCrumbsFileDrop('instance-1', event);

        expect(mocks.loadSampleFromPath).not.toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalled();
    });
});
