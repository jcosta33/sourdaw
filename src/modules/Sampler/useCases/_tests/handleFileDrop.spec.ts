import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DragEvent } from 'react';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { handleSamplerFileDrop } from '../handleFileDrop';

describe('handleSamplerFileDrop', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('does not load when not running in Tauri', async () => {
        const loadSampleFromPath = vi.fn();
        injectDependencies(handleSamplerFileDrop, {
            isTauri: () => false,
            loadSampleFromPath,
            switchSamplerMode: vi.fn(),
            samplerStore: { value: null },
        });

        const file = new File([], 'clip.wav', { type: 'audio/wav' });
        const event = {
            preventDefault: vi.fn(),
            stopPropagation: vi.fn(),
            dataTransfer: { files: [file] },
        } as unknown as DragEvent;

        await handleSamplerFileDrop(event);

        expect(loadSampleFromPath).not.toHaveBeenCalled();
    });
});
