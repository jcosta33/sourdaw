import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type TimelineRenderer } from '../models/RendererBackend';
import { initTimelineRenderer } from './initTimelineRenderer';

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
        Container.clear();
    });

    it('uses canvas when preferred backend is canvas2d', async () => {
        const canvasStub = stubRenderer('canvas2d');
        const createCanvasRenderer = vi.fn(() => canvasStub);
        injectDependencies(initTimelineRenderer, {
            getPreferredRendererBackend: () => 'canvas2d',
            createWebGpuRenderer: vi.fn(),
            createCanvasRenderer,
        });

        const canvas = document.createElement('canvas');
        const result = await initTimelineRenderer(canvas);

        expect(createCanvasRenderer).toHaveBeenCalledWith(canvas);
        expect(result).toBe(canvasStub);
    });

    it('uses webgpu when preferred and creation succeeds', async () => {
        const gpuStub = stubRenderer('webgpu');
        const createWebGpuRenderer = vi.fn(async () => gpuStub);
        injectDependencies(initTimelineRenderer, {
            getPreferredRendererBackend: () => 'webgpu',
            createWebGpuRenderer,
            createCanvasRenderer: vi.fn(),
        });

        const canvas = document.createElement('canvas');
        const result = await initTimelineRenderer(canvas);

        expect(createWebGpuRenderer).toHaveBeenCalledWith(canvas);
        expect(result).toBe(gpuStub);
    });

    it('falls back to canvas when webgpu path returns null', async () => {
        const canvasStub = stubRenderer('canvas2d');
        injectDependencies(initTimelineRenderer, {
            getPreferredRendererBackend: () => 'webgpu',
            createWebGpuRenderer: vi.fn(async () => null),
            createCanvasRenderer: vi.fn(() => canvasStub),
        });

        const canvas = document.createElement('canvas');
        const result = await initTimelineRenderer(canvas);

        expect(result).toBe(canvasStub);
    });
});
