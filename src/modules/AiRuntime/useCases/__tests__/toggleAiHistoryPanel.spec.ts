import { describe, expect, it, vi, beforeEach } from 'vitest';

import { toggleAiHistoryPanel } from '../toggleAiHistoryPanel';

const module_mocks = vi.hoisted(() => ({
    toggle_ai_history_panel: vi.fn<() => void>(),
}));

vi.mock('../../stores/aiActionHistoryStore', () => ({
    toggleAiHistoryPanel: module_mocks.toggle_ai_history_panel,
}));

describe('toggleAiHistoryPanel', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should route panel visibility writes through the AiRuntime store helper', () => {
        toggleAiHistoryPanel();

        expect(module_mocks.toggle_ai_history_panel).toHaveBeenCalledTimes(1);
    });
});
