import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { runEditorScript } from './runEditorScript';

function baseState(overrides: Partial<ExtensionMarketplaceState> = {}): ExtensionMarketplaceState {
    return {
        installed: [],
        commands: [],
        consoleLog: [],
        editorOpen: false,
        editorContent: '',
        ...overrides,
    };
}

describe('runEditorScript', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('runs editor content and logs completion', () => {
        const appendLog = vi.fn();
        const createDawApi = vi.fn(() => ({}));
        injectDependencies(runEditorScript, {
            extensionStore: {
                value: baseState({ editorContent: '' }),
                set: vi.fn(),
            } as never,
            appendLog,
            createDawApi,
        });
        runEditorScript();
        expect(appendLog).toHaveBeenCalledWith('info', '▶ Running script...');
        expect(appendLog).toHaveBeenCalledWith('info', '✓ Script completed');
        expect(createDawApi).toHaveBeenCalled();
    });
});
