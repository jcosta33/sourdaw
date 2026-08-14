import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { downloadBlob } from '../downloadFile';

/**
 * The anchor is a real element rather than a mock object so the tests can
 * observe whether it is attached to the document when the click is dispatched
 * — the thing a hand-rolled `{ click, href, download }` stub cannot see.
 */
function stubbedAnchor(): HTMLAnchorElement {
    const anchor = document.createElement('a');
    vi.spyOn(document, 'createElement').mockReturnValue(anchor);
    return anchor;
}

describe('downloadFile repository', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        global.URL.createObjectURL = vi.fn(() => 'blob:url');
        global.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('should create a blob and trigger download via a temporary link', () => {
        const anchor = stubbedAnchor();
        const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('some data', 'test.mid', 'audio/midi');

        expect(anchor.href).toBe('blob:url');
        expect(anchor.download).toBe('test.mid');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('keeps the anchor in the document while the click is dispatched', () => {
        const anchor = stubbedAnchor();
        let parentAtClick: Node | null = null;
        vi.spyOn(anchor, 'click').mockImplementation(() => {
            parentAtClick = anchor.parentNode;
        });

        downloadBlob('some data', 'test.mid', 'audio/midi');

        // A detached anchor is not guaranteed to dispatch a navigation.
        expect(parentAtClick).toBe(document.body);
    });

    it('does not revoke the object URL in the same task as the click', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('some data', 'test.mid', 'audio/midi');

        // Revoking synchronously can invalidate the URL before the browser has
        // resolved it, aborting the save with nothing surfaced to the user.
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    });

    it('revokes the object URL and detaches the anchor on a later task', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('some data', 'test.mid', 'audio/midi');
        vi.runAllTimers();

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url');
        expect(anchor.parentNode).toBeNull();
    });
});
