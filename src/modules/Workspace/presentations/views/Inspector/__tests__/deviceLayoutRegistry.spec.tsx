import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { registerDeviceLayout, registerPrefixLayout, resolveDeviceLayout, filterParams } from '../deviceLayoutRegistry';
import { SectionHeader } from '../SectionHeader';

import type { DeviceLayoutProps } from '../deviceLayoutRegistry';

// Mock external dependencies
vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, compact }: { title?: string; compact?: boolean }) => (
        <div data-testid="header-band" data-compact={compact}>
            {title}
        </div>
    ),
}));

// Create test components
const TestLayoutComponent = ({ device }: DeviceLayoutProps) => <div data-testid="test-layout">{device.name}</div>;
const PrefixLayout = () => <div>Prefix</div>;
const ExactLayout = () => <div>Exact</div>;

describe('deviceLayoutRegistry', () => {
    describe('registerDeviceLayout', () => {
        it('should register a single device type', () => {
            registerDeviceLayout('test-device', TestLayoutComponent);
            const resolved = resolveDeviceLayout('test-device');
            expect(resolved).toBe(TestLayoutComponent);
        });

        it('should register multiple device types', () => {
            registerDeviceLayout(['device-a', 'device-b'], TestLayoutComponent);
            expect(resolveDeviceLayout('device-a')).toBe(TestLayoutComponent);
            expect(resolveDeviceLayout('device-b')).toBe(TestLayoutComponent);
        });
    });

    describe('registerPrefixLayout', () => {
        it('should register a prefix matcher', () => {
            registerPrefixLayout('faust-', TestLayoutComponent);
            const resolved = resolveDeviceLayout('faust-instrument');
            expect(resolved).toBe(TestLayoutComponent);
        });

        it('should not match non-prefix types', () => {
            registerPrefixLayout('faust-', TestLayoutComponent);
            const resolved = resolveDeviceLayout('builtin-synth');
            expect(resolved).toBeNull();
        });
    });

    describe('resolveDeviceLayout', () => {
        it('should return null for unregistered device types', () => {
            const resolved = resolveDeviceLayout('unknown-device');
            expect(resolved).toBeNull();
        });

        it('should prefer exact match over prefix match', () => {
            registerPrefixLayout('test-', PrefixLayout);
            registerDeviceLayout('test-specific', ExactLayout);
            const resolved = resolveDeviceLayout('test-specific');
            expect(resolved).toBe(ExactLayout);
        });
    });

    describe('filterParams', () => {
        it('should filter parameters by IDs', () => {
            const params = [
                { id: 'gain', name: 'Gain' },
                { id: 'pan', name: 'Pan' },
                { id: 'volume', name: 'Volume' },
            ] as DeviceLayoutProps['parameters'];
            const filtered = filterParams(params, ['gain', 'volume']);
            expect(filtered).toHaveLength(2);
            expect(filtered[0].id).toBe('gain');
            expect(filtered[1].id).toBe('volume');
        });

        it('should return empty array when no IDs match', () => {
            const params = [{ id: 'gain', name: 'Gain' }] as DeviceLayoutProps['parameters'];
            const filtered = filterParams(params, ['nonexistent']);
            expect(filtered).toHaveLength(0);
        });
    });

    describe('SectionHeader', () => {
        it('should render header with title', () => {
            render(<SectionHeader title="Test Section" />);
            expect(screen.getByText('Test Section')).toBeInTheDocument();
        });

        it('should render with compact header band', () => {
            render(<SectionHeader title="Test Section" />);
            const headerBand = screen.getByTestId('header-band');
            expect(headerBand).toHaveAttribute('data-compact', 'true');
        });
    });
});
