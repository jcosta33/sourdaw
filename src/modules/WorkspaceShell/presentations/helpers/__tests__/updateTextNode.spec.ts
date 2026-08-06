import { describe, expect, it } from 'vitest';

import { updateTextNode } from '../updateTextNode';

describe('updateTextNode', () => {
    it('is a no-op when the element is null', () => {
        expect(() => updateTextNode(null, 'hello')).not.toThrow();
    });

    it('creates a text node via replaceChildren when the element is empty', () => {
        const el = document.createElement('span');
        updateTextNode(el, '42.0 dB');
        expect(el.textContent).toBe('42.0 dB');
        expect(el.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    });

    it('updates the existing text node in-place when the value changes (preserving node identity)', () => {
        const el = document.createElement('span');
        el.textContent = 'old';
        const originalNode = el.firstChild;
        updateTextNode(el, 'new');
        expect(el.textContent).toBe('new');
        // Same Text node reused — not replaced
        expect(el.firstChild).toBe(originalNode);
    });

    it('does not touch the text node when the value is unchanged', () => {
        const el = document.createElement('span');
        el.textContent = 'same';
        const originalNode = el.firstChild;
        const originalNodeValue = originalNode?.nodeValue;
        updateTextNode(el, 'same');
        expect(el.firstChild).toBe(originalNode);
        expect(el.firstChild?.nodeValue).toBe(originalNodeValue);
    });

    it('replaces all children via replaceChildren when the element has multiple nodes', () => {
        const el = document.createElement('div');
        el.appendChild(document.createTextNode('part-1'));
        el.appendChild(document.createElement('br'));
        updateTextNode(el, 'replacement');
        expect(el.textContent).toBe('replacement');
        expect(el.childNodes).toHaveLength(1);
        expect(el.firstChild?.nodeType).toBe(Node.TEXT_NODE);
    });
});
