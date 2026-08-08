import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    defaultMissingMediaStoreState,
    type MissingMediaItem,
    missingMediaStore,
} from '../../../stores/missingMediaStore';
import { MissingMediaPanel } from '../MissingMediaPanel';

function clipItem(overrides: Partial<MissingMediaItem> = {}): MissingMediaItem {
    return {
        bufferId: 'buf-gone',
        clipId: 'clip-1',
        kind: 'clip',
        label: 'Lost Guitar',
        trackId: 'track-1',
        trackName: 'Guitars',
        ...overrides,
    };
}

describe('MissingMediaPanel', () => {
    beforeEach(() => {
        missingMediaStore.set(defaultMissingMediaStoreState);
    });

    afterEach(() => {
        cleanup();
        missingMediaStore.set(defaultMissingMediaStoreState);
    });

    it('renders nothing when the load resolved every referenced buffer', () => {
        missingMediaStore.set({ items: [], scannedAt: Date.now() });

        const { container } = render(<MissingMediaPanel />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('surfaces a singular count when one reference is unresolved', () => {
        missingMediaStore.set({ items: [clipItem()], scannedAt: Date.now() });

        render(<MissingMediaPanel />);

        expect(screen.getByRole('button').textContent).toBe('1 missing file');
    });

    it('pluralises the count across multiple unresolved references', () => {
        missingMediaStore.set({
            items: [
                clipItem(),
                clipItem({
                    bufferId: 'freeze-gone',
                    clipId: undefined,
                    kind: 'frozenTrack',
                    label: 'Frozen track Pad',
                }),
            ],
            scannedAt: Date.now(),
        });

        render(<MissingMediaPanel />);

        expect(screen.getByRole('button').textContent).toBe('2 missing files');
    });

    it('keeps the detail list closed until the count is activated', () => {
        missingMediaStore.set({ items: [clipItem()], scannedAt: Date.now() });

        render(<MissingMediaPanel />);

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
    });

    it('lists each unresolved reference with its track and its repair route', () => {
        missingMediaStore.set({
            items: [
                clipItem(),
                {
                    bufferId: 'freeze-gone',
                    kind: 'frozenTrack',
                    label: 'Frozen track Pad',
                    trackId: 'track-2',
                    trackName: 'Pad',
                },
            ],
            scannedAt: Date.now(),
        });

        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button'));

        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]?.textContent).toBe('Lost GuitarGuitarsDrop a replacement file on the clip to relink it');
        expect(rows[1]?.textContent).toBe('Frozen track PadPadUnfreeze the track to re-render its audio');
        expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
    });

    it('closes the detail list on Escape', () => {
        missingMediaStore.set({ items: [clipItem()], scannedAt: Date.now() });

        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getByRole('dialog')).not.toBeNull();

        fireEvent.keyDown(document, { key: 'Escape' });

        expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('drops the surface when a later clean load clears the record', () => {
        missingMediaStore.set({ items: [clipItem()], scannedAt: Date.now() });
        const { container } = render(<MissingMediaPanel />);
        expect(screen.getByRole('button').textContent).toBe('1 missing file');

        act(() => {
            missingMediaStore.set({ items: [], scannedAt: Date.now() });
        });

        expect(container).toBeEmptyDOMElement();
    });
});
