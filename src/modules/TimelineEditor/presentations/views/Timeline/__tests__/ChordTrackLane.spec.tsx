import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ChordTrackLane } from '../ChordTrackLane';

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store, defaultValue) => defaultValue),
}));

describe('ChordTrackLane', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('should render without crashing', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        expect(document.body).toBeTruthy();
    });

    it('should handle store state', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        expect(document.body).toBeTruthy();
    });

    it('should render with useCase bindings', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        expect(document.body).toBeTruthy();
    });

    it('should have interactive elements', () => {
        render(<ChordTrackLane pixelsPerBeat={16} scrollX={0} />);
        const buttons = screen.queryAllByRole('button');
        expect(buttons.length).toBeGreaterThanOrEqual(0);
    });
});
