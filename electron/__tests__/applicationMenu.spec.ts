import { describe, expect, it, vi } from 'vitest';

import {
    applyNativeTextEdit,
    createApplicationMenuTemplate,
    dispatchFocusedNativeMenuIntent,
} from '../applicationMenu.js';

describe('createApplicationMenuTemplate', () => {
    it.each([
        ['File', 'New Project', 'CommandOrControl+N', { action: 'project:new' }],
        ['File', 'Import Project…', 'CommandOrControl+O', { action: 'project:import-project' }],
        ['File', 'Import Audio…', undefined, { action: 'project:import-audio' }],
        ['File', 'Import MIDI…', undefined, { action: 'project:import-midi' }],
        ['File', 'Save', 'CommandOrControl+S', { action: 'project:save' }],
        ['File', 'Export Audio…', 'CommandOrControl+Shift+E', { action: 'project:export-audio' }],
        ['File', 'Export Project File…', undefined, { action: 'project:export-file' }],
        ['Edit', 'Undo', 'CommandOrControl+Z', { action: 'edit:undo' }],
        ['Edit', 'Redo', 'CommandOrControl+Shift+Z', { action: 'edit:redo' }],
        ['Edit', 'Cut', 'CommandOrControl+X', { action: 'edit:cut' }],
        ['Edit', 'Copy', 'CommandOrControl+C', { action: 'edit:copy' }],
        ['Edit', 'Paste', 'CommandOrControl+V', { action: 'edit:paste' }],
        ['Edit', 'Select All', 'CommandOrControl+A', { action: 'edit:select-all' }],
        ['Edit', 'Deselect All', 'CommandOrControl+Shift+A', { action: 'edit:deselect-all' }],
        ['View', 'Toggle Sidebar', undefined, { action: 'view:toggle-sidebar' }],
        ['View', 'Toggle Mixer', undefined, { action: 'view:toggle-mixer' }],
        ['View', 'Toggle Inspector', undefined, { action: 'view:toggle-inspector' }],
        ['View', 'Toggle Track List', undefined, { action: 'view:toggle-track-list' }],
        ['View', 'Toggle Virtual Keyboard', undefined, { action: 'view:toggle-virtual-keyboard' }],
        ['View', 'Toggle Automation', undefined, { action: 'view:toggle-automation' }],
        ['View', 'Toggle AI Chat', undefined, { action: 'view:toggle-chat' }],
        ['View', 'Zoom In', 'CommandOrControl+=', { action: 'view:zoom-in' }],
        ['View', 'Zoom Out', 'CommandOrControl+-', { action: 'view:zoom-out' }],
        ['View', 'Zoom to Fit', undefined, { action: 'view:zoom-fit' }],
        ['View', 'Zoom to Selection', undefined, { action: 'view:zoom-selection' }],
        ['Help', 'Show Tour Again', undefined, { action: 'help:show-tour' }],
    ])('routes %s > %s with its product intent and accelerator', (menuLabel, itemLabel, accelerator, intent) => {
        const send = vi.fn();
        const template = createApplicationMenuTemplate({ appName: 'Sourdaw', send });
        const menu = template.find((item) => item.label === menuLabel);
        const item = menu?.submenu?.find((candidate) => candidate.label === itemLabel);

        expect(item?.accelerator).toBe(accelerator);
        item?.click?.();

        expect(send).toHaveBeenCalledWith(intent);
    });

    it('uses custom edit actions and routes every DAW command through the renderer', () => {
        const send = vi.fn();
        const template = createApplicationMenuTemplate({ appName: 'Sourdaw', send });
        const edit = template.find((item) => item.label === 'Edit');

        expect(edit?.submenu).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ label: 'Undo', accelerator: 'CommandOrControl+Z' }),
                expect.objectContaining({ label: 'Cut', accelerator: 'CommandOrControl+X' }),
                expect.objectContaining({ label: 'Paste', accelerator: 'CommandOrControl+V' }),
            ])
        );
        expect(edit?.submenu).not.toEqual(expect.arrayContaining([expect.objectContaining({ role: 'cut' })]));

        const undo = edit?.submenu?.find((item) => item.label === 'Undo');
        undo?.click?.();

        expect(send).toHaveBeenCalledWith({ action: 'edit:undo' });
    });

    it('keeps platform-owned application and window behaviors native', () => {
        const send = vi.fn();
        const template = createApplicationMenuTemplate({ appName: 'Sourdaw', send });

        expect(template.map((item) => item.label)).toEqual(['Sourdaw', 'File', 'Edit', 'View', 'Window', 'Help']);
        expect(template[0]?.submenu).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ role: 'services' }),
                expect.objectContaining({ role: 'quit' }),
                expect.objectContaining({ label: 'Settings…', accelerator: 'CommandOrControl+,' }),
            ])
        );
        expect(template[4]?.submenu).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ role: 'minimize' }),
                expect.objectContaining({ role: 'zoom' }),
            ])
        );
        const file = template.find((item) => item.label === 'File');
        expect(file?.submenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'close' })]));
        const settings = template[0]?.submenu?.find((item) => item.label === 'Settings…');
        settings?.click?.();
        expect(send).toHaveBeenCalledWith({ action: 'view:preferences' });
    });

    it('executes editable native text operations from the main-process target', () => {
        const target = {
            undo: vi.fn(),
            redo: vi.fn(),
            cut: vi.fn(),
            copy: vi.fn(),
            paste: vi.fn(),
            selectAll: vi.fn(),
        };

        expect(applyNativeTextEdit(target, 'edit:undo')).toBe(true);
        expect(applyNativeTextEdit(target, 'edit:paste')).toBe(true);
        expect(applyNativeTextEdit(target, 'edit:select-all')).toBe(true);
        expect(applyNativeTextEdit(target, 'edit:deselect-all')).toBe(false);
        expect(target.undo).toHaveBeenCalledOnce();
        expect(target.paste).toHaveBeenCalledOnce();
        expect(target.selectAll).toHaveBeenCalledOnce();
    });

    it.each([
        ['edit:undo', 'undo:'],
        ['edit:redo', 'redo:'],
        ['edit:cut', 'cut:'],
        ['edit:copy', 'copy:'],
        ['edit:paste', 'paste:'],
        ['edit:select-all', 'selectAll:'],
    ] as const)('keeps plugin-focused %s with the native responder selector %s', (action, responderAction) => {
        const target = {
            undo: vi.fn(),
            redo: vi.fn(),
            cut: vi.fn(),
            copy: vi.fn(),
            paste: vi.fn(),
            selectAll: vi.fn(),
        };
        const send = vi.fn();
        const sendToNativeResponder = vi.fn();

        expect(
            dispatchFocusedNativeMenuIntent({
                intent: { action },
                isMainWindowFocused: false,
                target,
                send,
                sendToNativeResponder,
            })
        ).toBe(false);

        expect(target.undo).not.toHaveBeenCalled();
        expect(target.redo).not.toHaveBeenCalled();
        expect(target.cut).not.toHaveBeenCalled();
        expect(target.copy).not.toHaveBeenCalled();
        expect(target.paste).not.toHaveBeenCalled();
        expect(target.selectAll).not.toHaveBeenCalled();
        expect(send).not.toHaveBeenCalled();
        expect(sendToNativeResponder).toHaveBeenCalledWith(responderAction);
    });

    it('still forwards a File command while a hosted plugin window owns focus', () => {
        const target = {
            undo: vi.fn(),
            redo: vi.fn(),
            cut: vi.fn(),
            copy: vi.fn(),
            paste: vi.fn(),
            selectAll: vi.fn(),
        };
        const send = vi.fn();
        const sendToNativeResponder = vi.fn();

        expect(
            dispatchFocusedNativeMenuIntent({
                intent: { action: 'project:save' },
                isMainWindowFocused: false,
                target,
                send,
                sendToNativeResponder,
            })
        ).toBe(true);

        expect(send).toHaveBeenCalledWith({ action: 'project:save' });
        expect(sendToNativeResponder).not.toHaveBeenCalled();
    });

    it('routes an Open Recent click with its exact saved-project key', () => {
        const send = vi.fn();
        const template = createApplicationMenuTemplate({
            appName: 'Sourdaw',
            send,
            recentProjects: [{ key: 'sourdaw:project:42', name: 'Saved song' }],
        });
        const file = template.find((item) => item.label === 'File');
        const openRecent = file?.submenu?.find((item) => item.label === 'Open Recent');
        const savedSong = openRecent?.submenu?.find((item) => item.label === 'Saved song');

        savedSong?.click?.();

        expect(send).toHaveBeenCalledWith({ action: 'project:open-recent', recentKey: 'sourdaw:project:42' });
    });

    it('leaves unmodified Fit shortcuts to the renderer', () => {
        const template = createApplicationMenuTemplate({ appName: 'Sourdaw', send: vi.fn() });
        const view = template.find((item) => item.label === 'View');
        const zoomToFit = view?.submenu?.find((item) => item.label === 'Zoom to Fit');
        const zoomToSelection = view?.submenu?.find((item) => item.label === 'Zoom to Selection');

        expect(zoomToFit).not.toHaveProperty('accelerator');
        expect(zoomToSelection).not.toHaveProperty('accelerator');
    });
});
