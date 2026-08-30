import { describe, expect, it, vi } from 'vitest';

import { createApplicationMenuTemplate } from '../applicationMenu.js';

describe('createApplicationMenuTemplate', () => {
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
        const template = createApplicationMenuTemplate({ appName: 'Sourdaw', send: vi.fn() });

        expect(template.map((item) => item.label)).toEqual(['Sourdaw', 'File', 'Edit', 'View', 'Window', 'Help']);
        expect(template[0]?.submenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'services' })]));
        expect(template[4]?.submenu).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ role: 'minimize' }),
                expect.objectContaining({ role: 'zoom' }),
            ])
        );
        const file = template.find((item) => item.label === 'File');
        expect(file?.submenu).toEqual(expect.arrayContaining([expect.objectContaining({ role: 'close' })]));
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
