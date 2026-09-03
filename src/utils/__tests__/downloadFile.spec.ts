import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { downloadBlob, OBJECT_URL_LIFETIME_MS } from '../downloadFile';

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

describe('downloadBlob utility', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        global.URL.createObjectURL = vi.fn(() => 'blob:url');
        global.URL.revokeObjectURL = vi.fn();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('triggers download via link with hidden display and target filename', () => {
        const anchor = stubbedAnchor();
        const click = vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('some data', 'test.mid', 'audio/midi');

        expect(anchor.href).toBe('blob:url');
        expect(anchor.download).toBe('test.mid');
        expect(anchor.style.display).toBe('none');
        expect(click).toHaveBeenCalledTimes(1);
    });

    it('keeps the anchor in document.body while the click is dispatched', () => {
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

    it('keeps the object URL alive past the next task, not just past the click', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('some data', 'test.mid', 'audio/midi');

        // Draining the microtask queue and the next macrotask only proves the
        // click handler returned. A large export can still be unread at that
        // point, and revoking then saves an empty file.
        vi.advanceTimersByTime(0);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        vi.advanceTimersByTime(OBJECT_URL_LIFETIME_MS - 1);
        expect(URL.revokeObjectURL).not.toHaveBeenCalled();

        vi.advanceTimersByTime(1);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url');
    });

    it('revokes the object URL and detaches the anchor after 1000ms', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('some data', 'test.mid', 'audio/midi');
        expect(anchor.parentNode).toBe(document.body);

        vi.advanceTimersByTime(OBJECT_URL_LIFETIME_MS);

        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url');
        expect(anchor.parentNode).toBeNull();
    });

    it('supports Blob inputs directly without wrapping in a new Blob', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {});

        const existingBlob = new Blob(['raw audio payload'], { type: 'audio/wav' });
        downloadBlob(existingBlob, 'export.wav');

        expect(URL.createObjectURL).toHaveBeenCalledWith(existingBlob);
        expect(anchor.download).toBe('export.wav');
        expect(anchor.href).toBe('blob:url');
    });

    it('supports BlobPart inputs with and without mimeType', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {});

        downloadBlob('{"key":"value"}', 'config.json', 'application/json');

        expect(URL.createObjectURL).toHaveBeenCalledWith(expect.any(Blob));
        expect(anchor.download).toBe('config.json');

        downloadBlob('raw text', 'plain.txt');
        expect(anchor.download).toBe('plain.txt');
    });

    it('cleans up even if the anchor was removed from the DOM before the timeout fires', () => {
        const anchor = stubbedAnchor();
        vi.spyOn(anchor, 'click').mockImplementation(() => {
            // Simulate external removal or weird DOM environment
            anchor.remove();
        });

        downloadBlob('test', 'test.txt');
        expect(anchor.parentNode).toBeNull();

        vi.advanceTimersByTime(OBJECT_URL_LIFETIME_MS);
        expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:url');
    });
});
