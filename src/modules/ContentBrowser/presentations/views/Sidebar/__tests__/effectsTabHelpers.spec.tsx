import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Music2 } from 'lucide-react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { NavCard, EffectItem, UnimplementedBadge, SoonBadge } from '../effectsTabHelpers';

import type { PluginDescriptorView as PluginDescriptor } from '../../../../models/PluginDescriptorViewTypes';
import type { SidebarPanelActions } from '../SidebarTypes';

const mocks = vi.hoisted(() => ({
    executeAddDeviceAction: vi.fn(),
    executeAppAction: vi.fn(),
}));

vi.mock('#/modules/Arrangement/useCases', () => ({
    executeAddDeviceAction: mocks.executeAddDeviceAction,
}));

vi.mock('#/modules/Command/useCases', () => ({
    executeAppAction: mocks.executeAppAction,
    executeUserAppAction: vi.fn(),
}));

const createPanelActions = (): SidebarPanelActions => ({
    showBacteria: vi.fn(),
    showCrumbs: vi.fn(),
    showCrust: vi.fn(),
    showDevice: vi.fn(),
    showDutchOven: vi.fn(),
    showFermenter: vi.fn(),
    showGluten: vi.fn(),
    showGrandBoule: vi.fn(),
    showLevain: vi.fn(),
    showProof: vi.fn(),
    showScoring: vi.fn(),
    showToaster: vi.fn(),
    showYeast: vi.fn(),
    revealDevice: vi.fn(),
});

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
        mocks.executeAddDeviceAction.mockReset();
        mocks.executeAppAction.mockReset();
        mocks.executeAddDeviceAction.mockResolvedValue({ status: 'applied', deviceId: 'device-1' });
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

            expect(mocks.executeAddDeviceAction).toHaveBeenCalledWith('t1', 'faust-de-esser');
        });

        it('adds the keyboard-activated effect by id as well', () => {
            const mockPlugin = createPlugin({ id: 'builtin-stereo-widener', name: 'Stereo Widener' });

            render(<EffectItem plugin={mockPlugin} selectedTrackId="t1" />);
            fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

            expect(mocks.executeAddDeviceAction).toHaveBeenCalledWith('t1', 'builtin-stereo-widener');
        });

        it('reveals the device a click added, once, after the add commits', async () => {
            mocks.executeAddDeviceAction.mockResolvedValue({ status: 'applied', deviceId: 'device-9' });
            const panelActions = createPanelActions();

            render(<EffectItem plugin={createPlugin({ id: 'eq' })} selectedTrackId="t1" panelActions={panelActions} />);
            fireEvent.click(screen.getByRole('button'));

            expect(mocks.executeAddDeviceAction).toHaveBeenCalledOnce();
            await waitFor(() => expect(panelActions.revealDevice).toHaveBeenCalledExactlyOnceWith('device-9'));
        });

        it('reveals the device a keyboard activation added', async () => {
            mocks.executeAddDeviceAction.mockResolvedValue({ status: 'applied', deviceId: 'device-9' });
            const panelActions = createPanelActions();

            render(<EffectItem plugin={createPlugin({ id: 'eq' })} selectedTrackId="t1" panelActions={panelActions} />);
            fireEvent.keyDown(screen.getByRole('button'), { key: ' ' });

            await waitFor(() => expect(panelActions.revealDevice).toHaveBeenCalledExactlyOnceWith('device-9'));
        });

        it('reveals a committed-degraded add, whose device is in project truth', async () => {
            mocks.executeAddDeviceAction.mockResolvedValue({ status: 'committed-degraded', deviceId: 'device-9' });
            const panelActions = createPanelActions();

            render(<EffectItem plugin={createPlugin({ id: 'eq' })} selectedTrackId="t1" panelActions={panelActions} />);
            fireEvent.click(screen.getByRole('button'));

            await waitFor(() => expect(panelActions.revealDevice).toHaveBeenCalledExactlyOnceWith('device-9'));
        });

        it('reveals nothing when the add was refused', async () => {
            mocks.executeAddDeviceAction.mockResolvedValue({ status: 'not-applied', deviceId: null });
            const panelActions = createPanelActions();

            render(<EffectItem plugin={createPlugin({ id: 'eq' })} selectedTrackId="t1" panelActions={panelActions} />);
            fireEvent.click(screen.getByRole('button'));

            expect(mocks.executeAddDeviceAction).toHaveBeenCalledOnce();
            // The component attached its reveal continuation to this promise
            // first, so it has run by the time this await resumes.
            await mocks.executeAddDeviceAction.mock.results[0]?.value;
            expect(panelActions.revealDevice).not.toHaveBeenCalled();
        });

        it('adds and reveals nothing without a selected track', () => {
            const panelActions = createPanelActions();

            render(
                <EffectItem plugin={createPlugin({ id: 'eq' })} selectedTrackId={null} panelActions={panelActions} />
            );
            fireEvent.click(screen.getByRole('button'));
            fireEvent.keyDown(screen.getByRole('button'), { key: 'Enter' });

            expect(mocks.executeAddDeviceAction).not.toHaveBeenCalled();
            expect(panelActions.revealDevice).not.toHaveBeenCalled();
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
