import { render, screen } from '@testing-library/react';
import { Music2 } from 'lucide-react';
import { describe, it, expect, vi } from 'vitest';

import { NavCard, EffectItem, UnimplementedBadge, SoonBadge } from '../effectsTabHelpers';

import type { PluginDescriptorView as PluginDescriptor } from '../../../../models/PluginDescriptorViewTypes';

const createPlugin = (overrides?: Partial<PluginDescriptor>): PluginDescriptor => ({
    id: 'builtin-reverb',
    name: 'Reverb',
    vendor: 'Sourdaw',
    format: 'builtin',
    category: 'effect',
    parameters: [],
    hasCustomUI: false,
    ...overrides,
});

describe('effectsTabHelpers components', () => {
    describe('NavCard', () => {
        it('should render correctly', () => {
            render(
                <NavCard
                    icon={Music2}
                    label="Test Card"
                    description="Test Description"
                    count={5}
                    color="text-blue-500"
                    onClick={vi.fn()}
                />
            );
            expect(screen.getByText('Test Card')).toBeInTheDocument();
            expect(screen.getByText('Test Description')).toBeInTheDocument();
            expect(screen.getByText('5')).toBeInTheDocument();
        });
    });

    describe('EffectItem', () => {
        it('should render correctly', () => {
            const mockPlugin = createPlugin({
                name: 'Test Effect',
                parameters: [{}, {}] as unknown as PluginDescriptor['parameters'],
            });
            render(<EffectItem plugin={mockPlugin} selectedTrackId="t1" />);
            expect(screen.getByText('Test Effect')).toBeInTheDocument();
            expect(screen.getByText('2 params')).toBeInTheDocument();
        });
    });

    describe('UnimplementedBadge', () => {
        it('should render correctly', () => {
            render(<UnimplementedBadge />);
            expect(screen.getByText('Soon')).toBeInTheDocument();
        });
    });

    describe('SoonBadge', () => {
        it('should render correctly', () => {
            render(<SoonBadge />);
            expect(screen.getByText('soon')).toBeInTheDocument();
        });
    });
});
