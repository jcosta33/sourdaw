import { render } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';

import { type SampleRecord } from '../../../models/LibraryTypes';
import { type LibraryState } from '../../../stores/libraryStore';
import { SpatialMapRenderer } from '../SpatialMapRenderer';

type Mocks = {
    libraryState: LibraryState | undefined;
};

const mocks = vi.hoisted((): Mocks => ({
    libraryState: undefined,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => mocks.libraryState ?? defaultValue),
}));

type GetContext2d = (contextId: '2d', options?: CanvasRenderingContext2DSettings) => CanvasRenderingContext2D | null;

function spyOnGetContext(ctx: CanvasRenderingContext2D): void {
    const proto: { getContext: GetContext2d } = HTMLCanvasElement.prototype;
    vi.spyOn(proto, 'getContext').mockReturnValue(ctx);
}

type CreateSampleInput = {
    id: string;
    x: number;
    y: number;
    favorite: boolean;
};

function createSample({ id, x, y, favorite }: CreateSampleInput): SampleRecord {
    return {
        id,
        libraryRootId: 'root1',
        relativePath: `${id}.wav`,
        displayName: id,
        ext: 'wav',
        folder: '',
        sync: { exists: true, status: 'indexed' },
        format: { durationSec: 1 },
        spatialMap: { x, y },
        tags: [],
        favorite,
    };
}

function setLibraryState(samples: SampleRecord[]): void {
    mocks.libraryState = {
        roots: [],
        samples,
        folderTrees: {},
        activeRootId: null,
        currentFolder: null,
        searchQuery: '',
        tagFilter: null,
        favoritesOnly: false,
        sortField: 'name',
        sortDirection: 'asc',
        scanning: false,
        scanProgress: 0,
    };
}

describe('SpatialMapRenderer', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('draws a filled circle per sample with spatial map coordinates', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const arcSpy = vi.spyOn(ctx, 'arc');
        const fillSpy = vi.spyOn(ctx, 'fill');
        const clearRectSpy = vi.spyOn(ctx, 'clearRect');
        spyOnGetContext(ctx);
        setLibraryState([
            createSample({ id: 's1', x: 0, y: 0, favorite: false }),
            createSample({ id: 's2', x: 1, y: 1, favorite: false }),
        ]);

        render(<SpatialMapRenderer width={100} height={100} />);

        expect(clearRectSpy).toHaveBeenCalledWith(0, 0, 100, 100);
        expect(arcSpy).toHaveBeenCalledTimes(2);
        expect(fillSpy).toHaveBeenCalledTimes(2);
    });

    it('skips samples without a spatial map projection', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const arcSpy = vi.spyOn(ctx, 'arc');
        spyOnGetContext(ctx);
        setLibraryState([
            createSample({ id: 's1', x: 0, y: 0, favorite: false }),
            { ...createSample({ id: 's2', x: 0, y: 0, favorite: false }), spatialMap: undefined },
        ]);

        render(<SpatialMapRenderer width={100} height={100} />);

        expect(arcSpy).toHaveBeenCalledTimes(1);
    });

    it('outlines favorite samples with a stroke but leaves non-favorites unstroked', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        const strokeSpy = vi.spyOn(ctx, 'stroke');
        spyOnGetContext(ctx);
        setLibraryState([
            createSample({ id: 's1', x: 0, y: 0, favorite: true }),
            createSample({ id: 's2', x: 1, y: 1, favorite: false }),
        ]);

        render(<SpatialMapRenderer width={100} height={100} />);

        expect(strokeSpy).toHaveBeenCalledTimes(1);
    });

    it('invokes onSampleClick with the id of the sample under the click point', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        spyOnGetContext(ctx);
        setLibraryState([
            createSample({ id: 'near', x: 0, y: 0, favorite: false }),
            createSample({ id: 'far', x: 1, y: 1, favorite: false }),
        ]);
        const onSampleClick = vi.fn();

        const { container } = render(<SpatialMapRenderer width={100} height={100} onSampleClick={onSampleClick} />);
        const canvas = container.querySelector('canvas');
        expect(canvas).not.toBeNull();
        vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
            right: 100,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        // x=0,y=0 sample projects to canvas pixel (50, 50); click right on it.
        canvas?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 50, clientY: 50 }));

        expect(onSampleClick).toHaveBeenCalledWith('near');
        expect(onSampleClick).not.toHaveBeenCalledWith('far');
    });

    it('does not invoke onSampleClick when the click misses every sample', () => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        spyOnGetContext(ctx);
        setLibraryState([createSample({ id: 'near', x: 0, y: 0, favorite: false })]);
        const onSampleClick = vi.fn();

        const { container } = render(<SpatialMapRenderer width={100} height={100} onSampleClick={onSampleClick} />);
        const canvas = container.querySelector('canvas');
        vi.spyOn(canvas!, 'getBoundingClientRect').mockReturnValue({
            left: 0,
            top: 0,
            width: 100,
            height: 100,
            right: 100,
            bottom: 100,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        });

        // Far corner of the canvas — nowhere near the (50, 50) sample.
        canvas?.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: 99, clientY: 99 }));

        expect(onSampleClick).not.toHaveBeenCalled();
    });
});
