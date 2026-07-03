import { render, screen, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { type YeastState } from '../../../stores/yeastStore';
import { YeastPanel } from '../YeastPanel';

const storeMock = vi.hoisted((): { yeastState: YeastState | null } => ({
    yeastState: null,
}));

vi.mock('#/infra/store/useStore', () => ({
    useStore: vi.fn((_store: unknown, defaultValue: YeastState): YeastState => storeMock.yeastState ?? defaultValue),
}));

describe('YeastPanel', () => {
    beforeEach(() => {
        storeMock.yeastState = null;
        vi.clearAllMocks();
    });

    it('should render the default rack when the store has no value', () => {
        render(<YeastPanel />);

        expect(screen.getByText('Note flow')).toBeInTheDocument();
        expect(screen.getByText('Phrase view')).toBeInTheDocument();
        expect(screen.getByText(/No processors yet/)).toBeInTheDocument();
    });

    it('should expose the default panel controls', () => {
        render(<YeastPanel />);

        expect(screen.getByRole('button', { name: 'Arp Off' })).toHaveAttribute('aria-pressed', 'false');
        expect(screen.getByRole('button', { name: 'Latch' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: '+ Arpeggiator' })).toBeInTheDocument();
        expect(screen.getByText('Mode')).toBeInTheDocument();
        expect(screen.getByText('Rate')).toBeInTheDocument();
    });

    it('should render stored processor rack text', () => {
        storeMock.yeastState = {
            processors: [
                {
                    id: 'arp-1',
                    type: 'arpeggiator',
                    name: 'Lead arp lane',
                    bypassed: false,
                },
                {
                    id: 'chord-1',
                    type: 'chord',
                    name: 'Harmony latch lane',
                    bypassed: true,
                },
            ],
            uiLevel: 3,
        };

        render(<YeastPanel />);

        expect(screen.getByText('Rack build')).toBeInTheDocument();
        const rack_read = screen.getByText('Rack read').closest('section');
        if (!rack_read) {
            throw new Error('Rack read section not found');
        }

        const rack_read_scope = within(rack_read);
        expect(rack_read_scope.getByText('Lead arp lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Harmony latch lane')).toBeInTheDocument();
        expect(rack_read_scope.getByText('arpeggiator')).toBeInTheDocument();
        expect(rack_read_scope.getByText('chord')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Bypass')).toBeInTheDocument();
        expect(rack_read_scope.getByText('Live')).toBeInTheDocument();
    });
});
