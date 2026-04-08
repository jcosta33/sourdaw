import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMock } from '#/infra/di/testing/createMock';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { parsePromptToActions } from './parsePromptToActions';
import { type Logger } from '#/helpers/Logger/Logger';
import { type ProjectContext } from '../models/ProjectContext';
import { tryPresetMatch, tryParameterizedPath, tryCompoundFastPath } from '../transformers/promptParser/parsing';
import { isDsoBackendAvailable } from './llmOrchestration/backendResolution';

vi.mock('../transformers/promptParser/parsing', () => ({
    tryPresetMatch: vi.fn(() => []),
    buildPresetContext: vi.fn(() => ({})),
    tryParameterizedPath: vi.fn(() => []),
    tryCompoundFastPath: vi.fn(() => null),
    requiresConfirmation: vi.fn(() => false),
}));

vi.mock('./llmOrchestration/backendResolution', () => ({
    isDsoBackendAvailable: vi.fn(() => false),
}));

const baseContext: ProjectContext = {
    tempo: 120,
    timeSignature: [4, 4],
    tracks: [],
    selectedTrackId: null,
    selectedClipId: null,
    selectedClipIds: [],
    activeView: 'arrange',
    playheadPosition: 0,
};

describe('parsePromptToActions', () => {
    beforeEach(() => {
        vi.mocked(tryPresetMatch).mockReturnValue([]);
        vi.mocked(tryParameterizedPath).mockReturnValue([]);
        vi.mocked(tryCompoundFastPath).mockReturnValue(null);
        vi.mocked(isDsoBackendAvailable).mockReturnValue(false);
    });

    it('should return empty intent when signal is aborted before LLM path', async () => {
        const logger = createMock<Logger>();
        injectDependencies(parsePromptToActions, { logger });

        const controller = new AbortController();
        controller.abort();

        const result = await parsePromptToActions('anything', baseContext, controller.signal);

        expect(result).toEqual({
            actions: [],
            confidence: 0,
            rawText: 'anything',
            requiresConfirmation: false,
        });
    });
});
