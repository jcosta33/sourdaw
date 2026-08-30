import { describe, expect, it } from 'vitest';

import { isKeyboardEditableTarget } from '../isKeyboardEditableTarget';
import { isNativeTextEditableTarget } from '../isNativeTextEditableTarget';

describe('canvas keyboard focus classification', () => {
    it.each(['root', 'nested descendant'] as const)(
        'treats a canvas editor %s as keyboard-owned but not native text',
        (kind) => {
            const editor = document.createElement('div');
            editor.dataset.canvasEditor = '';
            const target = kind === 'root' ? editor : document.createElement('span');
            if (target !== editor) {
                editor.append(target);
            }
            expect(isKeyboardEditableTarget(target)).toBe(true);
            expect(isNativeTextEditableTarget(target)).toBe(false);
        }
    );
});
