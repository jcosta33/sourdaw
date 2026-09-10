import { BaseWindow } from 'electron';

import type { EditorWindow, EditorWindowOptions } from './pluginGui.js';

/**
 * A bare native window for one plugin editor: no webcontents, hidden until the
 * addon has run the GUI lifecycle and knows the plugin's preferred size, and
 * `resizable: false` until the plugin has said whether its editor accepts a
 * size the host chose — an answer that does not exist until that lifecycle has
 * run. 800×600 is only the pre-lifecycle placeholder the addon immediately
 * resizes.
 */
export const createEditorWindow = (options: EditorWindowOptions): EditorWindow =>
    new BaseWindow({
        width: 800,
        height: 600,
        title: options.title,
        show: false,
        resizable: false,
        alwaysOnTop: options.alwaysOnTop,
        ...(options.parent === undefined ? {} : { parent: options.parent }),
    });
