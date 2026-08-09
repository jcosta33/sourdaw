import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { projectLoadFailureStore } from '#/modules/Project/stores';

import { useGlobalKeyboardShortcuts } from '../keyboardShortcutsContract';

import type { KeyDescriptor } from '../../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown';

const mocks = vi.hoisted(() => ({
    handleKeydown: vi.fn<(desc: KeyDescriptor) => boolean>(() => false),
    handleKeyup: vi.fn<(key: string) => void>(() => undefined),
}));

vi.mock('../../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeydown', () => ({
    handleKeydown: mocks.handleKeydown,
}));
vi.mock('../../../useCases/keyboardShortcutActions/handleKeyboardShortcut/handleKeyup', () => ({
    handleKeyup: mocks.handleKeyup,
}));

const Host = (): null => {
    useGlobalKeyboardShortcuts();
    return null;
};

// Reads the `isInput` flag the contract passed on the most recent keydown.
// jsdom returns `undefined` (not `false`) for `HTMLElement.isContentEditable`
// on non-editable nodes, so the contract's `... || target.isContentEditable`
// can yield `undefined` for an ungated target; that is still "not gated".
// We therefore assert on truthiness (gated vs not) rather than `=== false`.
function lastIsInput(): boolean {
    const calls = mocks.handleKeydown.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return Boolean(calls[calls.length - 1]![0].isInput);
}

describe('useGlobalKeyboardShortcuts — data-canvas-editor delete gate (#21)', () => {
    let cleanupNodes: HTMLElement[] = [];

    beforeEach(() => {
        mocks.handleKeydown.mockClear();
        mocks.handleKeyup.mockClear();
        cleanupNodes = [];
        projectLoadFailureStore.set(null);
    });

    afterEach(() => {
        for (const node of cleanupNodes) {
            node.remove();
        }
    });

    function mount(node: HTMLElement): HTMLElement {
        document.body.appendChild(node);
        cleanupNodes.push(node);
        return node;
    }

    /**
     * A load that replaced the CRDT authority and then failed leaves the stores
     * empty while `projectStore` still carries the previous project's
     * `createdAt` — so `saveProject` keys the recent entry off the user's real
     * project and serialises the emptied stores over it. The failure surface's
     * button is not an input and not a canvas editor, so every global shortcut
     * was still live behind it.
     */
    it('routes no shortcut to the app while a failed load is on screen', () => {
        render(<Host />);
        const button = mount(document.createElement('button'));
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Half Finished Song' });

        button.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));

        expect(mocks.handleKeydown).not.toHaveBeenCalled();
    });

    it('routes shortcuts normally once a project is open again', () => {
        render(<Host />);
        const button = mount(document.createElement('button'));
        projectLoadFailureStore.set(null);

        button.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));

        expect(mocks.handleKeydown).toHaveBeenCalledTimes(1);
    });

    it('gates the global shortcut (isInput=true) when Delete fires inside a [data-canvas-editor]', () => {
        render(<Host />);
        const editor = mount(document.createElement('div'));
        editor.setAttribute('data-canvas-editor', '');
        const canvas = editor.appendChild(document.createElement('canvas'));

        canvas.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

        // The canvas editor owns Delete, so the contract must treat focus here
        // like a text input and suppress the arrangement clip-delete shortcut.
        expect(lastIsInput()).toBe(true);
    });

    it('does NOT gate the global shortcut when Delete fires on an unmarked timeline surface', () => {
        render(<Host />);
        const timeline = mount(document.createElement('div'));

        timeline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

        // The arrangement timeline is not marked, so Delete must still reach the
        // global clip-delete path — the gate is not always-true.
        expect(lastIsInput()).toBe(false);
    });

    it('still gates real text inputs (INPUT / TEXTAREA / contentEditable)', () => {
        render(<Host />);
        const input = mount(document.createElement('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        expect(lastIsInput()).toBe(true);

        mocks.handleKeydown.mockClear();
        const textarea = mount(document.createElement('textarea'));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        expect(lastIsInput()).toBe(true);
    });
});
