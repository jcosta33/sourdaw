import { describe, it, expect, vi, beforeEach } from 'vitest';
import { type TimelineRenderer } from '../../models/RendererBackend';
import { initTimelineRenderer } from '../initTimelineRenderer';
import { getPreferredRendererBackend } from '../../models/RendererBackend';
import { createWebGpuRenderer } from '../../presentations/renderers/createWebGpuRenderer';
import { createCanvasRenderer } from '../../presentations/renderers/createCanvasRenderer';

vi.mock('../../models/RendererBackend', () => ({
    getPreferredRendererBackend: vi.fn(),
}));

vi.mock('../../presentations/renderers/createWebGpuRenderer', () => ({
    createWebGpuRenderer: vi.fn(),
}));

vi.mock('../../presentations/renderers/createCanvasRenderer', () => ({
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

describe('initTimelineRenderer', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('uses canvas when preferred backend is canvas2d', async () => {
        const canvasStub = stubRenderer('canvas2d');
        vi.mocked(getPreferredRendererBackend).mockReturnValue('canvas2d');
        vi.mocked(createCanvasRenderer).mockReturnValue(canvasStub as any);

        const canvas = document.createElement('canvas');
        const result = await initTimelineRenderer(canvas);

        expect(createCanvasRenderer).toHaveBeenCalledWith(canvas);
        expect(result).toBe(canvasStub);
    });

    it('uses webgpu when preferred and creation succeeds', async () => {
        const gpuStub = stubRenderer('webgpu');
        vi.mocked(getPreferredRendererBackend).mockReturnValue('webgpu');
        vi.mocked(createWebGpuRenderer).mockResolvedValue(gpuStub as any);

        const canvas = document.createElement('canvas');
        const result = await initTimelineRenderer(canvas);

        expect(createWebGpuRenderer).toHaveBeenCalledWith(canvas);
        expect(result).toBe(gpuStub);
    });

    it('falls back to canvas when webgpu path returns null', async () => {
        const canvasStub = stubRenderer('canvas2d');
        vi.mocked(getPreferredRendererBackend).mockReturnValue('webgpu');
        vi.mocked(createWebGpuRenderer).mockResolvedValue(null as any);
        vi.mocked(createCanvasRenderer).mockReturnValue(canvasStub as any);

        const canvas = document.createElement('canvas');
        const result = await initTimelineRenderer(canvas);

        expect(result).toBe(canvasStub);
    });
});
