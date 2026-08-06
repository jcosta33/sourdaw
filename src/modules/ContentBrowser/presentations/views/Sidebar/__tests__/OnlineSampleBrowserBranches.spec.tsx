import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../hooks/usePreviewAudio', () => ({
    usePreviewAudio: () => ({ playingId: null, play: vi.fn(), playTone: vi.fn(), playFile: vi.fn(), stop: vi.fn() }),
}));

import { OnlineSampleBrowser } from '../OnlineSampleBrowser';

function makePreview() {
    return { playingId: null, play: vi.fn(), playTone: vi.fn(), playFile: vi.fn(), stop: vi.fn() };
}

describe('OnlineSampleBrowser — category labels', () => {
    it('renders all 6 category headers', () => {
        render(<OnlineSampleBrowser preview={makePreview()} />);
        expect(screen.getByText('Drums & Percussion')).toBeInTheDocument();
        expect(screen.getByText('Instruments')).toBeInTheDocument();
        expect(screen.getByText('Orchestral')).toBeInTheDocument();
        expect(screen.getByText('Synths & Electronic')).toBeInTheDocument();
        expect(screen.getByText('Vocals')).toBeInTheDocument();
        expect(screen.getByText('Collections')).toBeInTheDocument();
    });
});

describe('OnlineSampleBrowser — source links', () => {
    it('renders at least one external link per category', () => {
        render(<OnlineSampleBrowser preview={makePreview()} />);
        const links = screen.getAllByRole('link');
        expect(links.length).toBeGreaterThan(6);
    });

    it('renders license badge text for sources', () => {
        render(<OnlineSampleBrowser preview={makePreview()} />);
        // Multiple sources have CC0 — use getAllByText
        expect(screen.getAllByText('CC0').length).toBeGreaterThan(0);
    });

    it('renders the intro paragraph', () => {
        render(<OnlineSampleBrowser preview={makePreview()} />);
        expect(screen.getByText(/Free sample libraries/i)).toBeInTheDocument();
    });
});

describe('OnlineSampleBrowser — source names', () => {
    it('renders known source names', () => {
        render(<OnlineSampleBrowser preview={makePreview()} />);
        // At least a few source names should appear
        const links = screen.getAllByRole('link');
        const names = links.map((l) => l.textContent ?? '');
        expect(names.some((n) => n.includes('LMMS'))).toBe(true);
        expect(names.some((n) => n.includes('VCSL'))).toBe(true);
    });
});
