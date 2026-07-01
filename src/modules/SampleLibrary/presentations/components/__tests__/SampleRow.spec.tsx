import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { type SampleRecord } from '../../../models/LibraryTypes';
import { SampleRow } from '../SampleRow';

type CreateSampleInput = {
    ext: string;
};

function createSample({ ext }: CreateSampleInput): SampleRecord {
    return {
        id: 's1',
        libraryRootId: 'r1',
        relativePath: `a.${ext}`,
        displayName: 'a',
        ext,
        folder: '/',
        sync: { exists: true, status: 'indexed' },
        format: { durationSec: 1.2 },
        tags: [],
        favorite: false,
    };
}

type RenderSampleRowInput = {
    ext: string;
    showBrowserDecodeWarnings: boolean;
};

function renderSampleRow({ ext, showBrowserDecodeWarnings }: RenderSampleRowInput): void {
    render(
        <SampleRow
            sample={createSample({ ext })}
            isPlaying={false}
            showBrowserDecodeWarnings={showBrowserDecodeWarnings}
            onPlay={vi.fn()}
            onStop={vi.fn()}
            onToggleFavorite={vi.fn()}
            onFindSimilar={vi.fn()}
            onDragStart={vi.fn()}
            onClick={vi.fn()}
        />
    );
}

describe('SampleRow', () => {
    it('should render', () => {
        renderSampleRow({ ext: 'wav', showBrowserDecodeWarnings: false });

        expect(screen.getByText('a')).toBeInTheDocument();
    });

    it.each(['aiff', 'aif', 'flac', 'aac', 'm4a'])(
        'should show the browser risky-format badge for %s when browser warnings are enabled',
        (ext) => {
            renderSampleRow({ ext, showBrowserDecodeWarnings: true });

            expect(screen.getByTitle(`${ext.toUpperCase()} may not preview in your browser`)).toBeInTheDocument();
        }
    );

    it('should not show the browser risky-format badge when browser warnings are disabled', () => {
        renderSampleRow({ ext: 'flac', showBrowserDecodeWarnings: false });

        expect(screen.queryByTitle('FLAC may not preview in your browser')).not.toBeInTheDocument();
    });
});
