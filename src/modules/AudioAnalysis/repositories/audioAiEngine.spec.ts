import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { generateAudio, separateStems } from './audioAiEngine';
import { type Logger } from '#/helpers/Logger/Logger';
import { isTauri, tauriInvoke } from '#/helpers/tauriBridge';
import { separateStemsBrowser } from './browserStemSeparation';

vi.mock('#/helpers/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

vi.mock('./browserStemSeparation', () => ({
    separateStemsBrowser: vi.fn(() => Promise.resolve({})),
}));

describe('audioAiEngine injectables', () => {
    beforeEach(() => {
        vi.mocked(isTauri).mockReset();
        vi.mocked(tauriInvoke).mockReset();
        vi.mocked(separateStemsBrowser).mockReset();
        vi.mocked(separateStemsBrowser).mockResolvedValue({});
    });

    it('should reject generateAudio when not running in Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const logger = createMock<Logger>();
        injectDependencies(generateAudio, { logger });

        await expect(generateAudio('bells', 4)).rejects.toThrow(/desktop-only/);
    });

    it('should delegate to browser separation when not in Tauri', async () => {
        vi.mocked(isTauri).mockReturnValue(false);

        const logger = createMock<Logger>();
        injectDependencies(separateStems, { logger });

        const buf = new ArrayBuffer(8);
        await separateStems(buf, ['vocals']);

        expect(separateStemsBrowser).toHaveBeenCalledWith(buf, ['vocals']);
    });
});
