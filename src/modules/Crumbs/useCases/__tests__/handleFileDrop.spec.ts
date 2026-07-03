import { describe, it, expect, vi, beforeEach } from 'vitest';

import { handleCrumbsFileDrop } from '../handleFileDrop';

const mocks = vi.hoisted(() => ({
    isCrumbsNativeAvailable: vi.fn<() => boolean>(),
    getDroppedCrumbsFilePath: vi.fn<(input: { file: File }) => Promise<string | null>>(),
    loadSampleFromPath: vi.fn<(instanceId: string, filePath: string) => Promise<void>>(),
    switchCrumbsMode:
        vi.fn<(instanceId: string, mode: import('../../models/CrumbsTypes').CrumbsMode) => Promise<void>>(),
    crumbsStore: {
        value: null as unknown as Record<
            string,
            { activeSample: { category: import('../../models/CrumbsTypes').SampleCategory } | null }
        > | null,
    },
    logger: { warn: vi.fn<() => void>() },
}));

vi.mock('../../repositories/is-crumbs-native-available', () => ({
    isCrumbsNativeAvailable: mocks.isCrumbsNativeAvailable,
}));

vi.mock('../../repositories/get-dropped-crumbs-file-path', () => ({
    getDroppedCrumbsFilePath: mocks.getDroppedCrumbsFilePath,
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

function createDropEvent(file: File): DragEvent {
    const event = new Event('drop') as DragEvent;
    Object.defineProperty(event, 'dataTransfer', { value: { files: [file] } });
    return event;
}

describe('handleCrumbsFileDrop', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should not load and should warn when native Crumbs file drops are unavailable', async () => {
        mocks.isCrumbsNativeAvailable.mockReturnValue(false);
        mocks.crumbsStore.value = null;

        const file = new File([], 'clip.wav', { type: 'audio/wav' });
        const readBytes = vi.spyOn(file, 'arrayBuffer');
        const event = createDropEvent(file);

        await handleCrumbsFileDrop('instance-1', event);

        expect(mocks.getDroppedCrumbsFilePath).not.toHaveBeenCalled();
        expect(mocks.loadSampleFromPath).not.toHaveBeenCalled();
        expect(readBytes).not.toHaveBeenCalled();
        expect(mocks.logger.warn).toHaveBeenCalled();
    });

    it('should load the desktop path and switch to the suggested mode', async () => {
        mocks.isCrumbsNativeAvailable.mockReturnValue(true);
        mocks.getDroppedCrumbsFilePath.mockResolvedValue('/Users/me/Loops/clip.wav');
        mocks.loadSampleFromPath.mockResolvedValue(undefined);
        mocks.switchCrumbsMode.mockResolvedValue(undefined);
        mocks.crumbsStore.value = {
            'instance-1': {
                activeSample: { category: 'loop' },
            },
        };

        const file = new File([], 'clip.wav', { type: 'audio/wav' });
        const event = createDropEvent(file);

        await handleCrumbsFileDrop('instance-1', event);

        expect(mocks.getDroppedCrumbsFilePath).toHaveBeenCalledWith({ file });
        expect(mocks.loadSampleFromPath).toHaveBeenCalledWith('instance-1', '/Users/me/Loops/clip.wav');
        expect(mocks.switchCrumbsMode).toHaveBeenCalledWith('instance-1', 'slice');
        expect(mocks.logger.warn).not.toHaveBeenCalled();
    });

    it('should load the copied IPC temp path for dropped files without a desktop path', async () => {
        mocks.isCrumbsNativeAvailable.mockReturnValue(true);
        mocks.getDroppedCrumbsFilePath.mockResolvedValue('crumbs-drops/drop-1/clip.wav');
        mocks.loadSampleFromPath.mockResolvedValue(undefined);
        mocks.switchCrumbsMode.mockResolvedValue(undefined);
        mocks.crumbsStore.value = {
            'instance-1': {
                activeSample: { category: 'percussive' },
            },
        };

        const file = new File([new Uint8Array([1, 2, 3])], 'clip.wav', { type: 'audio/wav' });
        const event = createDropEvent(file);

        await handleCrumbsFileDrop('instance-1', event);

        expect(mocks.getDroppedCrumbsFilePath).toHaveBeenCalledWith({ file });
        expect(mocks.loadSampleFromPath).toHaveBeenCalledWith('instance-1', 'crumbs-drops/drop-1/clip.wav');
        expect(mocks.loadSampleFromPath).not.toHaveBeenCalledWith('instance-1', 'clip.wav');
        expect(mocks.switchCrumbsMode).toHaveBeenCalledWith('instance-1', 'drum');
    });
});
