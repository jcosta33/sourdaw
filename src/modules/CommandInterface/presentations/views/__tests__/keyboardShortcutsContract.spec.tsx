import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { currentKeyboardLayoutMap } from '#/infra/keyboardLayout/keyboardLayoutMap';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { defaultProjectStoreState, projectLoadFailureStore, projectStore } from '#/modules/Project/stores';
import { type ActionHandler } from '#/utils/handlerContract';

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

// Reports whether the contract classified the most recent keydown as text entry.
// jsdom returns `undefined` (not `false`) for `HTMLElement.isContentEditable`
// on non-editable nodes, so the contract's `... || target.isContentEditable`
// can yield `undefined` for an ungated target; that is still "not gated".
// We therefore assert on truthiness (gated vs not) rather than `=== false`.
function lastIsInput(): boolean {
    const calls = mocks.handleKeydown.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1]![0].keyTarget === 'textEntry';
}

function lastKeyTarget(): string {
    const calls = mocks.handleKeydown.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    return calls[calls.length - 1]![0].keyTarget;
}

function stubTogglePlaybackHandler(): ActionHandler {
    return {
        undoable: false,
        execute: () => {},
        describe: () => ({ label: 'togglePlayback' }),
    };
}

describe('useGlobalKeyboardShortcuts — canvas editors claim their own keys (#21)', () => {
    let cleanupNodes: HTMLElement[] = [];

    beforeEach(() => {
        mocks.handleKeydown.mockClear();
        mocks.handleKeyup.mockClear();
        cleanupNodes = [];
        projectLoadFailureStore.set(null);
        projectStore.set({ ...structuredClone(defaultProjectStoreState), loading: true });
        clearHandlerRegistry();
    });

    afterEach(() => {
        for (const node of cleanupNodes) {
            node.remove();
        }
        clearHandlerRegistry();
    });

    function dispatchSpace(target: HTMLElement): void {
        target.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    }

    function dispatchKey(target: HTMLElement, init: KeyboardEventInit): KeyboardEvent {
        const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
        target.dispatchEvent(event);
        return event;
    }

    function openSessionWithCommandHandlers(): void {
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
        });
        registerHandlerMap({ togglePlayback: stubTogglePlaybackHandler() });
    }

    // jsdom does not compute :focus-visible; stub the one element for the
    // focus-time read, then focus it so a real focusin event is dispatched.
    function focusWithModality(element: HTMLElement, focusVisible: boolean): void {
        const nativeMatches = element.matches.bind(element);
        vi.spyOn(element, 'matches').mockImplementation((selector: string) =>
            selector === ':focus-visible' ? focusVisible : nativeMatches(selector)
        );
        element.focus();
    }

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
    it('routes no shortcut to the app while the project is still loading', () => {
        render(<Host />);
        const button = mount(document.createElement('button'));
        registerHandlerMap({ togglePlayback: stubTogglePlaybackHandler() });

        dispatchSpace(button);

        expect(mocks.handleKeydown).not.toHaveBeenCalled();
    });

    it('routes no shortcut to the app while command handlers are not registered', () => {
        render(<Host />);
        const button = mount(document.createElement('button'));
        projectStore.set({
            ...structuredClone(defaultProjectStoreState),
            loading: false,
            initialized: true,
        });

        dispatchSpace(button);

        expect(mocks.handleKeydown).not.toHaveBeenCalled();
    });

    it('routes no shortcut to the app while a failed load is on screen', () => {
        render(<Host />);
        const button = mount(document.createElement('button'));
        openSessionWithCommandHandlers();
        projectLoadFailureStore.set({ message: 'session gone', projectName: 'Half Finished Song' });

        button.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));

        expect(mocks.handleKeydown).not.toHaveBeenCalled();
    });

    it('routes shortcuts normally once a project is open again', () => {
        render(<Host />);
        const button = mount(document.createElement('button'));
        openSessionWithCommandHandlers();
        projectLoadFailureStore.set(null);

        button.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true }));

        expect(mocks.handleKeydown).toHaveBeenCalledTimes(1);
    });

    it('routes undo to the global layer while a [data-canvas-editor] has focus', () => {
        openSessionWithCommandHandlers();
        render(<Host />);
        const editor = mount(document.createElement('div'));
        editor.setAttribute('data-canvas-editor', '');
        const canvas = editor.appendChild(document.createElement('canvas'));

        dispatchKey(canvas, { key: 'z', metaKey: true });

        expect(mocks.handleKeydown).toHaveBeenCalledTimes(1);
        expect(mocks.handleKeydown.mock.calls[0]![0]).toMatchObject({ key: 'z', mod: true });
        expect(lastKeyTarget()).toBe('noteEditor');
    });

    it('routes Space to the global layer while a [data-canvas-editor] has focus', () => {
        openSessionWithCommandHandlers();
        render(<Host />);
        const editor = mount(document.createElement('div'));
        editor.setAttribute('data-canvas-editor', '');
        const canvas = editor.appendChild(document.createElement('canvas'));

        dispatchKey(canvas, { key: ' ' });

        expect(mocks.handleKeydown).toHaveBeenCalledTimes(1);
        expect(lastKeyTarget()).toBe('noteEditor');
    });

    it('skips a key the focused canvas editor claimed with preventDefault in its React handler', () => {
        openSessionWithCommandHandlers();
        const claimedKeys = ['Delete', 'Enter', '5'];
        render(
            <>
                <Host />
                <div data-canvas-editor="">
                    <canvas
                        data-testid="claiming-canvas"
                        tabIndex={0}
                        onKeyDown={(event) => {
                            if (claimedKeys.includes(event.key)) {
                                event.preventDefault();
                            }
                        }}
                    />
                </div>
            </>
        );
        const canvas = document.querySelector<HTMLElement>('[data-testid="claiming-canvas"]')!;

        const claimed = dispatchKey(canvas, { key: 'Delete' });
        expect(claimed.defaultPrevented).toBe(true);
        expect(mocks.handleKeydown).not.toHaveBeenCalled();

        for (const key of ['Enter', '5']) {
            const claimedOther = dispatchKey(canvas, { key });
            expect(claimedOther.defaultPrevented, key).toBe(true);
        }
        expect(mocks.handleKeydown).not.toHaveBeenCalled();

        dispatchKey(canvas, { key: 'z', metaKey: true });
        expect(mocks.handleKeydown).toHaveBeenCalledTimes(1);
    });

    it('does NOT gate the global shortcut when Delete fires on an unmarked timeline surface', () => {
        openSessionWithCommandHandlers();
        render(<Host />);
        const timeline = mount(document.createElement('div'));

        timeline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

        // The arrangement timeline is not marked, so Delete must still reach the
        // global clip-delete path — the gate is not always-true.
        expect(lastIsInput()).toBe(false);
    });

    it('still gates real text inputs (INPUT / TEXTAREA / contentEditable)', () => {
        openSessionWithCommandHandlers();
        render(<Host />);
        const input = mount(document.createElement('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        expect(lastIsInput()).toBe(true);

        mocks.handleKeydown.mockClear();
        const textarea = mount(document.createElement('textarea'));
        textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
        expect(lastIsInput()).toBe(true);
    });

    it.each(['Home', 'End', ' '])('keeps native %s navigation inside a select', (key) => {
        openSessionWithCommandHandlers();
        mocks.handleKeydown.mockImplementation((descriptor) => descriptor.keyTarget !== 'textEntry');
        render(<Host />);
        const select = mount(document.createElement('select'));

        const event = dispatchKey(select, { key });

        expect(lastIsInput()).toBe(true);
        expect(event.defaultPrevented).toBe(false);
    });

    it('still delegates the command-palette exception from a select', () => {
        openSessionWithCommandHandlers();
        mocks.handleKeydown.mockImplementation((descriptor) => descriptor.key === 'k' && descriptor.mod);
        render(<Host />);
        const select = mount(document.createElement('select'));

        const event = dispatchKey(select, { key: 'k', metaKey: true });

        expect(lastIsInput()).toBe(true);
        expect(event.defaultPrevented).toBe(true);
    });

    describe('native Tab traversal', () => {
        it.each([
            ['Tab', false],
            ['Shift+Tab', true],
        ])('leaves %s on an interactive control for native focus traversal', (_label, shiftKey) => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));

            const event = dispatchKey(button, { key: 'Tab', shiftKey });

            expect(mocks.handleKeydown).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        it('leaves Tab on native form, link, contenteditable, and tabindex controls for native traversal', () => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const contentEditable = document.createElement('div');
            contentEditable.setAttribute('contenteditable', 'true');
            const controls = [
                document.createElement('input'),
                document.createElement('select'),
                document.createElement('textarea'),
                Object.assign(document.createElement('a'), { href: '#toolbar' }),
                contentEditable,
                Object.assign(document.createElement('span'), { tabIndex: 0 }),
            ];

            for (const control of controls) {
                mount(control);
                const event = dispatchKey(control, { key: 'Tab' });
                expect(event.defaultPrevented, control.outerHTML).toBe(false);
            }

            expect(mocks.handleKeydown).not.toHaveBeenCalled();
        });

        it.each([
            ['Tab', false],
            ['Shift+Tab', true],
        ])('leaves %s on a browser-focused negative-tabindex surface for native traversal', (_label, shiftKey) => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const scrollport = mount(document.createElement('div'));
            scrollport.tabIndex = -1;
            scrollport.focus();
            expect(document.activeElement).toBe(scrollport);

            const event = dispatchKey(scrollport, { key: 'Tab', shiftKey });

            expect(mocks.handleKeydown).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        it.each([
            ['Tab', false],
            ['Shift+Tab', true],
        ])('leaves %s on the focused piano-roll canvas to the note-editor policy', (_label, shiftKey) => {
            openSessionWithCommandHandlers();
            // handleKeydown does not admit workspace-mode Tab for a note
            // editor, so it returns false and the default is not prevented.
            mocks.handleKeydown.mockReturnValue(false);
            render(<Host />);
            const editor = mount(document.createElement('div'));
            editor.setAttribute('data-canvas-editor', '');
            const canvas = editor.appendChild(document.createElement('canvas'));
            canvas.tabIndex = 0;
            canvas.focus();
            expect(document.activeElement).toBe(canvas);

            const event = dispatchKey(canvas, { key: 'Tab', shiftKey });

            expect(mocks.handleKeydown).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ key: 'Tab', keyTarget: 'noteEditor' })
            );
            expect(event.defaultPrevented).toBe(false);
        });

        it('still delegates workspace-mode Tab from the body and a focused arrangement canvas', () => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const canvas = mount(document.createElement('canvas'));
            canvas.tabIndex = 0;
            canvas.focus();
            expect(document.activeElement).toBe(canvas);

            const bodyEvent = dispatchKey(document.body, { key: 'Tab' });
            const canvasEvent = dispatchKey(canvas, { key: 'Tab' });

            expect(mocks.handleKeydown).toHaveBeenCalledTimes(2);
            for (const call of mocks.handleKeydown.mock.calls) {
                expect(call[0]).toMatchObject({ key: 'Tab', keyTarget: 'workspace' });
            }
            expect(bodyEvent.defaultPrevented).toBe(true);
            expect(canvasEvent.defaultPrevented).toBe(true);
        });

        it('still delegates unrelated and modified shortcuts from controls', () => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));

            const unrelatedEvent = dispatchKey(button, { key: 'b' });
            const modifiedTabEvent = dispatchKey(button, { key: 'Tab', ctrlKey: true });

            expect(mocks.handleKeydown).toHaveBeenCalledTimes(2);
            expect(unrelatedEvent.defaultPrevented).toBe(true);
            expect(modifiedTabEvent.defaultPrevented).toBe(true);
        });
    });

    describe('native button activation', () => {
        it.each(['Enter', ' '])('leaves unmodified %s to a focused button', (key) => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));
            focusWithModality(button, true);

            const event = dispatchKey(button, { key });

            expect(mocks.handleKeydown).not.toHaveBeenCalled();
            expect(event.defaultPrevented).toBe(false);
        });

        it.each(['Enter', ' '])('routes %s from a focused button that is not focus-visible (mouse click)', (key) => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));
            focusWithModality(button, false);

            const event = dispatchKey(button, { key });

            expect(mocks.handleKeydown).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ key }));
            expect(event.defaultPrevented).toBe(true);
        });

        it('prevents the default of Enter on a mouse-focused button even when the shortcut reports false (stop)', () => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(false);
            render(<Host />);
            const button = mount(document.createElement('button'));
            focusWithModality(button, false);

            const event = dispatchKey(button, { key: 'Enter' });

            expect(mocks.handleKeydown).toHaveBeenCalledOnce();
            expect(event.defaultPrevented).toBe(true);
        });

        it('forgets keyboard focus when the button is refocused without it', () => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));
            focusWithModality(button, true);
            button.blur();
            focusWithModality(button, false);

            dispatchKey(button, { key: ' ' });

            expect(mocks.handleKeydown).toHaveBeenCalledOnce();
        });

        it.each(['Enter', ' '])('routes modified %s from a focused button', (key) => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));
            button.focus();

            const event = dispatchKey(button, { key, metaKey: true });

            expect(mocks.handleKeydown).toHaveBeenCalledExactlyOnceWith(
                expect.objectContaining({ key, mod: true, keyTarget: 'workspace' })
            );
            expect(event.defaultPrevented).toBe(true);
        });

        it('continues routing unrelated keys and unmarked workspace Enter and Space', () => {
            openSessionWithCommandHandlers();
            mocks.handleKeydown.mockReturnValue(true);
            render(<Host />);
            const button = mount(document.createElement('button'));
            const canvas = mount(document.createElement('canvas'));
            button.focus();

            const unrelated = dispatchKey(button, { key: 'b' });
            const workspaceEnter = dispatchKey(canvas, { key: 'Enter' });
            const workspaceSpace = dispatchKey(document.body, { key: ' ' });

            expect(mocks.handleKeydown).toHaveBeenCalledTimes(3);
            expect(unrelated.defaultPrevented).toBe(true);
            expect(workspaceEnter.defaultPrevented).toBe(true);
            expect(workspaceSpace.defaultPrevented).toBe(true);
        });

        it('keeps modal and input gates and keyup cleanup', () => {
            openSessionWithCommandHandlers();
            const { unmount } = render(<Host />);
            const input = mount(document.createElement('input'));
            const dialog = mount(document.createElement('div'));
            dialog.setAttribute('role', 'dialog');
            const dialogButton = dialog.appendChild(document.createElement('button'));

            dispatchKey(input, { key: 'Enter' });
            expect(lastIsInput()).toBe(true);
            dispatchKey(dialogButton, { key: 'Enter' });
            expect(lastIsInput()).toBe(true);
            dialogButton.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            expect(mocks.handleKeyup).toHaveBeenCalledExactlyOnceWith('Enter');

            unmount();
            dialogButton.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }));
            expect(mocks.handleKeyup).toHaveBeenCalledTimes(1);
        });
    });

    describe('modal and menu portal surfaces (#3618)', () => {
        it('gates the global shortcut (isInput=true) when Delete fires inside a [role="dialog"] surface', () => {
            openSessionWithCommandHandlers();
            render(<Host />);
            // Radix Dialog and Popover content render role="dialog" and hold
            // focus while open; the hand-rolled dialogService portals mark the
            // same role. A keydown originating inside must not fall through to
            // the arrangement clip-delete behind the surface.
            const dialog = mount(document.createElement('div'));
            dialog.setAttribute('role', 'dialog');
            const surfaceButton = dialog.appendChild(document.createElement('button'));

            surfaceButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

            expect(lastIsInput()).toBe(true);
        });

        it('gates the global shortcut (isInput=true) when Backspace fires inside a [role="menu"] surface', () => {
            openSessionWithCommandHandlers();
            render(<Host />);
            // Radix DropdownMenu content renders role="menu" and moves focus
            // into it on open; the context-menu portals mark the same role.
            const menu = mount(document.createElement('div'));
            menu.setAttribute('role', 'menu');
            const menuItem = menu.appendChild(document.createElement('div'));
            menuItem.setAttribute('role', 'menuitem');

            menuItem.dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true }));

            expect(lastIsInput()).toBe(true);
        });

        it('gates the global shortcut (isInput=true) when Delete fires inside a [role="listbox"] surface', () => {
            openSessionWithCommandHandlers();
            render(<Host />);
            // Selection popups such as the mixer's routing menus render
            // role="listbox" with tab-focusable option buttons.
            const listbox = mount(document.createElement('div'));
            listbox.setAttribute('role', 'listbox');
            const option = listbox.appendChild(document.createElement('div'));
            option.setAttribute('role', 'option');

            option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

            expect(lastIsInput()).toBe(true);
        });

        it('gates the global shortcut (isInput=true) when Delete fires inside a [role="alertdialog"] surface', () => {
            openSessionWithCommandHandlers();
            render(<Host />);
            // Alert surfaces such as the load-failure overlay render
            // role="alertdialog" and hold focus while on screen.
            const alert = mount(document.createElement('div'));
            alert.setAttribute('role', 'alertdialog');
            const surfaceButton = alert.appendChild(document.createElement('button'));

            surfaceButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

            expect(lastIsInput()).toBe(true);
        });

        it('does NOT gate a keydown originating outside an open dialog surface', () => {
            openSessionWithCommandHandlers();
            render(<Host />);
            // The gate is origin-based, not presence-based: an open dialog
            // elsewhere in the document must not steal the timeline's Delete.
            const dialog = mount(document.createElement('div'));
            dialog.setAttribute('role', 'dialog');
            const timeline = mount(document.createElement('div'));

            timeline.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));

            expect(lastIsInput()).toBe(false);
        });
    });

    describe('key identity', () => {
        afterEach(() => {
            Reflect.deleteProperty(navigator, 'keyboard');
        });

        it('hands handleKeydown the physical key for a modifier-altered character', () => {
            openSessionWithCommandHandlers();
            render(<Host />);
            const timeline = mount(document.createElement('div'));

            dispatchKey(timeline, { key: '∂', code: 'KeyD', altKey: true });
            dispatchKey(timeline, { key: '!', code: 'Digit1', shiftKey: true });

            expect(mocks.handleKeydown.mock.calls.map(([desc]) => desc)).toMatchObject([
                { key: 'd', alt: true, shift: false },
                { key: '1', alt: false, shift: true },
            ]);
        });

        it('resolves through the loaded keyboard layout map rather than the US table', async () => {
            // AZERTY: the physical KeyQ key types `a`; Option+A reports `æ` there.
            Object.defineProperty(navigator, 'keyboard', {
                configurable: true,
                value: { getLayoutMap: () => Promise.resolve(new Map([['KeyQ', 'a']])) },
            });
            openSessionWithCommandHandlers();
            render(<Host />);
            const timeline = mount(document.createElement('div'));
            await vi.waitFor(() => {
                expect(currentKeyboardLayoutMap()?.get('KeyQ')).toBe('a');
            });

            dispatchKey(timeline, { key: 'æ', code: 'KeyQ', altKey: true });

            expect(mocks.handleKeydown.mock.calls.at(-1)?.[0]).toMatchObject({ key: 'a', alt: true });
        });
    });
});
