import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type TimelineRenderer } from '../../../models/RendererBackend';
import { getPreferredRendererBackend } from '../../../models/RendererBackend';
import { createCanvasRenderer } from '../createCanvasRenderer';
import { createTimelineRenderer } from '../createTimelineRenderer';
import { createWebGpuRenderer } from '../createWebGpuRenderer';

vi.mock('../../../models/RendererBackend', () => ({
    getPreferredRendererBackend: vi.fn(),
}));

vi.mock('../createWebGpuRenderer', () => ({
    createWebGpuRenderer: vi.fn(),
}));

vi.mock('../createCanvasRenderer', () => ({
    createCanvasRenderer: vi.fn(),
}));

function stubRenderer(backend: TimelineRenderer['backend']): TimelineRenderer {
    return {
        backend,
        render: vi.fn(),
        resize: vi.fn(),
        dispose: vi.fn(),
    };
}

describe('createTimelineRenderer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses canvas when preferred backend is canvas2d', async () => {
        const canvasStub = stubRenderer('canvas2d');
        vi.mocked(getPreferredRendererBackend).mockReturnValue('canvas2d');
        vi.mocked(createCanvasRenderer).mockReturnValue(canvasStub);

        const canvas = document.createElement('canvas');
        const result = await createTimelineRenderer(canvas);

        expect(createCanvasRenderer).toHaveBeenCalledWith(canvas);
        expect(result).toBe(canvasStub);
    });

    it('uses webgpu when preferred and creation succeeds', async () => {
        const gpuStub = stubRenderer('webgpu');
        vi.mocked(getPreferredRendererBackend).mockReturnValue('webgpu');
        vi.mocked(createWebGpuRenderer).mockResolvedValue(gpuStub);

        const canvas = document.createElement('canvas');
        const result = await createTimelineRenderer(canvas);

        expect(createWebGpuRenderer).toHaveBeenCalledWith(canvas);
        expect(result).toBe(gpuStub);
    });

    it('falls back to canvas when webgpu path returns null', async () => {
        const canvasStub = stubRenderer('canvas2d');
        vi.mocked(getPreferredRendererBackend).mockReturnValue('webgpu');
        vi.mocked(createWebGpuRenderer).mockResolvedValue(null);
        vi.mocked(createCanvasRenderer).mockReturnValue(canvasStub);

        const canvas = document.createElement('canvas');
        const result = await createTimelineRenderer(canvas);

        expect(result).toBe(canvasStub);
    });
});
