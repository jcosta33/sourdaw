import { describe, expect, it } from 'vitest';

import { isNativeTextEditableTarget } from '../isNativeTextEditableTarget';

describe('isNativeTextEditableTarget', () => {
    it.each([
        ['input', () => document.createElement('input'), true],
        ['textarea', () => document.createElement('textarea'), true],
        [
            'contenteditable',
            () => {
                const element = document.createElement('div');
                element.setAttribute('contenteditable', 'true');
                return element;
            },
            true,
        ],
        [
            'inherited editing host',
            () => {
                const element = document.createElement('div');
                Object.defineProperty(element, 'isContentEditable', { value: true });
                return element;
            },
            true,
        ],
        [
            'canvas editor',
            () => {
                const element = document.createElement('div');
                element.dataset.canvasEditor = '';
                return element;
            },
            false,
        ],
        ['ordinary element', () => document.createElement('div'), false],
    ] as const)('classifies %s as %s', (_label, create, expected) => {
        expect(isNativeTextEditableTarget(create())).toBe(expected);
    });
});
