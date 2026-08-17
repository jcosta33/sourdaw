import { fireEvent, render, screen } from '@testing-library/react';
import { Music2 } from 'lucide-react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NavCard, EffectItem, UnimplementedBadge, SoonBadge } from '../effectsTabHelpers';

import type { PluginDescriptorView as PluginDescriptor } from '../../../../models/PluginDescriptorViewTypes';

const mocks = vi.hoisted(() => ({
    compileAddDeviceAction: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    compileAddDeviceAction: mocks.compileAddDeviceAction,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
}));

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
    beforeEach(() => {
        mocks.compileAddDeviceAction.mockReset();
        mocks.executeAppAction.mockReset();
        mocks.compileAddDeviceAction.mockImplementation((trackId: string, deviceType: string) => ({
            type: 'addDevice',
            payload: { trackId, deviceType, deviceId: 'device-1', expectedDeviceIds: [] },
        }));
        mocks.executeAppAction.mockResolvedValue(undefined);
    });

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

        // The application compiler carries the catalog id. `De-esser`, `LUFS Meter`
        // and `Stereo Widener` each name two catalog plugins — a builtin and a
        // Faust one — so a name lookup returns whichever the registry lists
        // first, which need not be the card that was clicked.
        it('adds the clicked effect by id, so a name two plugins share cannot pick the other one', () => {
            const mockPlugin = createPlugin({ id: 'faust-de-esser', name: 'De-esser' });

            render(<EffectItem plugin={mockPlugin} selectedTrackId="t1" />);
            fireEvent.click(screen.getByRole('button'));

            expect(mocks.compileAddDeviceAction).toHaveBeenCalledWith('t1', 'faust-de-esser');
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'addDevice',
                payload: { trackId: 't1', deviceType: 'faust-de-esser', deviceId: 'device-1', expectedDeviceIds: [] },
            });
        });

        it('adds the keyboard-activated effect by id as well', () => {
            const mockPlugin = createPlugin({ id: 'builtin-stereo-widener', name: 'Stereo Widener' });

            render(<EffectItem plugin={mockPlugin} selectedTrackId="t1" />);
            fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

            expect(mocks.compileAddDeviceAction).toHaveBeenCalledWith('t1', 'builtin-stereo-widener');
            expect(mocks.executeAppAction).toHaveBeenCalledWith({
                type: 'addDevice',
                payload: {
                    trackId: 't1',
                    deviceType: 'builtin-stereo-widener',
                    deviceId: 'device-1',
                    expectedDeviceIds: [],
                },
            });
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
