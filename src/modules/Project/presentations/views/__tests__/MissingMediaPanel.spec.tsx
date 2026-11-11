import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { revealClip } from '#/modules/Arrangement/useCases';

import {
    defaultMissingMediaStoreState,
    type MissingMediaItem,
    missingMediaStore,
} from '../../../stores/missingMediaStore';
import { locateMissingMedia } from '../../../useCases/locateMissingMedia';
import { MissingMediaPanel } from '../MissingMediaPanel';

vi.mock('#/modules/Arrangement/useCases', () => ({ revealClip: vi.fn() }));
vi.mock('../../../useCases/locateMissingMedia', () => ({ locateMissingMedia: vi.fn() }));

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
        missingMediaStore.set({ items: [] });

        const { container } = render(<MissingMediaPanel />);

        expect(container).toBeEmptyDOMElement();
        expect(screen.queryByRole('button')).toBeNull();
    });

    it('surfaces a singular count when one reference is unresolved', () => {
        missingMediaStore.set({ items: [clipItem()] });

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
        });

        render(<MissingMediaPanel />);

        expect(screen.getByRole('button').textContent).toBe('2 missing files');
    });

    it('keeps the detail list closed until the count is activated', () => {
        missingMediaStore.set({ items: [clipItem()] });

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
        });

        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button'));

        const rows = screen.getAllByRole('listitem');
        expect(rows).toHaveLength(2);
        expect(rows[0]?.textContent).toContain('Drop a replacement file on the clip to relink it');
        expect(rows[1]?.textContent).toBe('Frozen track PadPadUnfreeze the track to re-render its audio');
        expect(screen.getByRole('button', { name: 'Locate…' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Reveal clip' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '2 missing files — show details' })).toHaveAttribute(
            'aria-expanded',
            'true'
        );
    });

    it('locates a missing source through the recovery use case', async () => {
        vi.mocked(locateMissingMedia).mockResolvedValue();
        missingMediaStore.set({ items: [clipItem()] });
        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button', { name: /1 missing file/ }));

        fireEvent.click(screen.getByRole('button', { name: 'Locate…' }));

        expect(locateMissingMedia).toHaveBeenCalledExactlyOnceWith({
            sourceBufferId: 'buf-gone',
            label: 'Lost Guitar',
        });
        expect(await screen.findByRole('button', { name: 'Locate…' })).toBeEnabled();
    });

    it('reveals the exact clip reference without a file-level duplicate action', () => {
        missingMediaStore.set({
            items: [
                clipItem({ clipId: 'clip-left', label: 'Take (a)' }),
                clipItem({ clipId: 'clip-right', label: 'Take (b)' }),
            ],
        });
        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button', { name: /1 missing file/ }));

        expect(screen.getAllByRole('button', { name: 'Locate…' })).toHaveLength(1);
        const revealButtons = screen.getAllByRole('button', { name: 'Reveal clip' });
        expect(revealButtons).toHaveLength(2);
        fireEvent.click(revealButtons[1]!);

        expect(revealClip).toHaveBeenCalledExactlyOnceWith('clip-right');
    });

    it('keeps frozen-track recovery out of the ordinary relink and reveal actions', () => {
        missingMediaStore.set({
            items: [
                clipItem({
                    bufferId: 'freeze-gone',
                    clipId: undefined,
                    kind: 'frozenTrack',
                    label: 'Frozen track Pad',
                }),
            ],
        });
        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button', { name: /1 missing file/ }));

        expect(screen.queryByRole('button', { name: 'Locate…' })).toBeNull();
        expect(screen.queryByRole('button', { name: 'Reveal clip' })).toBeNull();
        expect(screen.getByText('Unfreeze the track to re-render its audio')).toBeInTheDocument();
    });

    it('counts files rather than references when a split clip shares one buffer', () => {
        // `splitClip` spreads the source clip into both halves, so two clips sit
        // on one track sharing `audioBufferId` — one file the user has to find,
        // not two.
        missingMediaStore.set({
            items: [
                clipItem({ clipId: 'clip-left', label: 'Take (a)' }),
                clipItem({ clipId: 'clip-right', label: 'Take (b)' }),
            ],
        });

        render(<MissingMediaPanel />);

        expect(screen.getByRole('button').textContent).toBe('1 missing file');
        fireEvent.click(screen.getByRole('button'));
        expect(screen.getAllByRole('listitem')).toHaveLength(2);
        expect(screen.getByText(/Used by 2 clips and tracks/).textContent).toBe(
            'Used by 2 clips and tracks — relinking a file repairs every place it is used.'
        );
    });

    it('omits the reference note when every row is its own file', () => {
        missingMediaStore.set({
            items: [clipItem(), clipItem({ bufferId: 'other-gone', clipId: 'clip-2', label: 'Other' })],
        });

        render(<MissingMediaPanel />);

        expect(screen.getByRole('button').textContent).toBe('2 missing files');
        fireEvent.click(screen.getByRole('button'));
        expect(screen.queryByText(/Used by/)).toBeNull();
    });

    it('gives split clips distinct react keys', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        missingMediaStore.set({
            items: [
                clipItem({ clipId: 'clip-left', label: 'Take (a)' }),
                clipItem({ clipId: 'clip-right', label: 'Take (b)' }),
            ],
        });

        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button'));

        const duplicateKeyWarnings = consoleError.mock.calls.filter((call) =>
            call.some((arg) => typeof arg === 'string' && arg.includes('same key'))
        );
        expect(duplicateKeyWarnings).toEqual([]);
        consoleError.mockRestore();
    });

    it('portals its panel to document body outside the trigger container', () => {
        missingMediaStore.set({ items: [clipItem()] });
        const { container } = render(<MissingMediaPanel />);
        const trigger = screen.getByRole('button');

        fireEvent.click(trigger);

        const panel = screen.getByRole('dialog', { name: 'Missing media' });
        expect(panel).toBeInTheDocument();
        expect(container.contains(panel)).toBe(false);
        expect(document.body.contains(panel)).toBe(true);
    });

    it('closes the detail list and consumes Escape', () => {
        missingMediaStore.set({ items: [clipItem()] });

        render(<MissingMediaPanel />);
        fireEvent.click(screen.getByRole('button'));
        const dialog = screen.getByRole('dialog');
        const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });

        act(() => {
            dialog.dispatchEvent(escape);
        });

        expect(screen.queryByRole('dialog')).toBeNull();
        expect(escape.defaultPrevented).toBe(true);
    });

    it('drops the surface when a later clean load clears the record', () => {
        missingMediaStore.set({ items: [clipItem()] });
        const { container } = render(<MissingMediaPanel />);
        expect(screen.getByRole('button').textContent).toBe('1 missing file');

        act(() => {
            missingMediaStore.set({ items: [] });
        });

        expect(container).toBeEmptyDOMElement();
    });
});
