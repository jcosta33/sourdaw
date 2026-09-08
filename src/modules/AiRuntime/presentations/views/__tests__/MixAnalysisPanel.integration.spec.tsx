import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { getAnalysisHandlers, setMixAnalysisDisplayLifecycle } from '#/modules/AudioAnalysis/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeUserAppAction } from '#/modules/Command/useCases';

import { MixAnalysisPanel } from '../MixAnalysisPanel';

const mocks = vi.hoisted(() => ({
    get_master_analyser: vi.fn(),
    fail_lifecycle: vi.fn<(input: { token: number }) => void>(),
    toggle_panel: vi.fn<() => void>(),
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: () => ({ result: null, isAnalyzing: false, panelOpen: true }),
}));

vi.mock('#/modules/AiRuntime/stores/mixAnalysisStore', () => ({
    mixAnalysisStore: { name: 'mixAnalysisStore' },
    toggleMixAnalysisPanel: mocks.toggle_panel,
}));

vi.mock('#/modules/AudioEngine/useCases', async (import_original) => ({
    ...(await import_original<typeof import('#/modules/AudioEngine/useCases')>()),
    getMasterAnalyser: mocks.get_master_analyser,
}));

describe('MixAnalysisPanel action dispatch integration', () => {
    beforeEach(() => {
        clearHandlerRegistry();
        registerHandlerMap(getAnalysisHandlers());
        mocks.fail_lifecycle.mockClear();
        mocks.get_master_analyser.mockReset();
        setMixAnalysisDisplayLifecycle({
            begin: () => 17,
            complete: () => undefined,
            fail: mocks.fail_lifecycle,
        });
    });

    afterEach(() => {
        clearHandlerRegistry();
        setMixAnalysisDisplayLifecycle({
            begin: () => null,
            complete: () => undefined,
            fail: () => undefined,
        });
    });

    it('should surface a real analyzeMix handler rejection after lifecycle cleanup', async () => {
        const failure = new Error('master analyser unavailable');
        mocks.get_master_analyser.mockImplementation(() => {
            throw failure;
        });
        render(<MixAnalysisPanel />);

        fireEvent.click(screen.getByLabelText('Refresh mix analysis'));

        await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(failure.message));
        expect(mocks.fail_lifecycle).toHaveBeenCalledWith({ token: 17 });
    });

    it('stops real registered mix analysis before it reads the analyser when command cancellation is already signalled', async () => {
        const controller = new AbortController();
        const cancellation = new Error('mix analysis cancelled');
        controller.abort(cancellation);

        await expect(executeUserAppAction({ type: 'analyzeMix' }, { signal: controller.signal })).rejects.toBe(
            cancellation
        );

        expect(mocks.fail_lifecycle).toHaveBeenCalledExactlyOnceWith({ token: 17 });
        expect(mocks.get_master_analyser).not.toHaveBeenCalled();
    });
});
