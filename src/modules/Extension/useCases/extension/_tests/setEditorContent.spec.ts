import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Container } from '#/infra/di/Container';
import { injectDependencies } from '#/infra/di/testing/injectDependencies';
import { type ExtensionMarketplaceState } from '#/modules/Extension/stores/extension';
import { setEditorContent } from '../setEditorContent';

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

describe('setEditorContent', () => {
    beforeEach(() => {
        Container.clear();
    });

    it('writes editorContent', () => {
        const set = vi.fn();
        injectDependencies(setEditorContent, {
            extensionStore: { value: baseState(), set } as never,
        });
        setEditorContent('code');
        expect(set).toHaveBeenCalledWith(expect.objectContaining({ editorContent: 'code' }));
    });
});
