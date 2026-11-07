import { describe, expect, it } from 'vitest';

import { isKeyboardEditableTarget } from '../isKeyboardEditableTarget';
import { isNativeTextEditableTarget } from '../isNativeTextEditableTarget';

describe('canvas keyboard focus classification', () => {
    it('still treats text inputs as keyboard-editable', () => {
        expect(isKeyboardEditableTarget(document.createElement('input'))).toBe(true);
        expect(isKeyboardEditableTarget(document.createElement('textarea'))).toBe(true);
    });

    it.each(['root', 'nested descendant'] as const)(
        'treats a canvas editor %s as neither a text target nor native text',
        (kind) => {
            const editor = document.createElement('div');
            editor.dataset.canvasEditor = '';
            const target = kind === 'root' ? editor : document.createElement('span');
            if (target !== editor) {
                editor.append(target);
            }
            expect(isKeyboardEditableTarget(target)).toBe(false);
            expect(isNativeTextEditableTarget(target)).toBe(false);
        }
    );
});
