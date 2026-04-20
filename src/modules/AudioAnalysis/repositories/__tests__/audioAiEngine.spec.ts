import { describe, it, expect, vi, beforeEach } from 'vitest';

import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { isTauri, tauriInvoke } from '#/utils/tauriBridge';

import { generateAudio, separateStems } from '../audioAiEngine';
import { separateStemsBrowser } from '../browserStemSeparation';

import { type Logger } from '#/infra/logger/types';

vi.mock('#/utils/tauriBridge', () => ({
    isTauri: vi.fn(),
    tauriInvoke: vi.fn(),
}));

vi.mock('../browserStemSeparation', () => ({
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
