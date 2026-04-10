import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { toggleScriptEditor } from './toggleScriptEditor';

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

describe('toggleScriptEditor', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('flips editorOpen', () => {
        const set = vi.fn();
        injectDependencies(toggleScriptEditor, {
            extensionStore: { value: baseState({ editorOpen: false }), set } as never,
        });
        toggleScriptEditor();
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ editorOpen: true }));
    });
});
