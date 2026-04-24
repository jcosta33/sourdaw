import { render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_PATCH } from '../../../models/GrinderPatch';
import { grinderStore } from '../../../stores/grinderStore';
import { GrinderPanel } from '../GrinderPanel';

describe('GrinderPanel', () => {
    const device_id = 'test-device';

    beforeEach(() => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'lab',
                    gateEnabled: true,
                },
            },
        });
    });

    it('should render an explicit gate enable toggle in the lab section', () => {
        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByRole('button', { name: 'Gate On' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('should render an enabled drive pedal as pressed when the stored patch enables it', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [
                        {
                            id: 'od1',
                            type: 'overdrive',
                            enabled: true,
                            params: { drive: 4.5, tone: 5.5, level: 6.8 },
                        },
                    ],
                },
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByRole('button', { name: 'Overdrive' })).toHaveAttribute('aria-pressed', 'true');
    });

    it('should show non-duplicated neural status content instead of a repeated mode guide', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'neural',
                    engineMode: 'capture',
                    neuralEnabled: true,
                    neuralModelName: 'Factory Voice A',
                    neuralModelFamily: 'NAM-compatible',
                },
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.queryByText('Mode guide')).not.toBeInTheDocument();
        expect(screen.getByText('Signal path')).toBeInTheDocument();
        expect(screen.getByText(/selecting a library voice now swaps the active built-in capture profile/i)).toBeInTheDocument();
    });

    it('should expose the current front-end pedal chain order in the drive section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'drive',
                    prePedals: [
                        {
                            id: 'dist1',
                            type: 'distortion',
                            enabled: true,
                            params: { drive: 4.2, tone: 4.4, level: 6.0 },
                        },
                        {
                            id: 'od1',
                            type: 'overdrive',
                            enabled: true,
                            params: { drive: 2.8, tone: 5.2, level: 5.4 },
                        },
                    ],
                },
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Chain order')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /1 Distortion/i })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /2 Overdrive/i })).toBeInTheDocument();
    });

    it('should expose a direct room control in the cab section', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    uiSection: 'cab',
                },
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Room')).toBeInTheDocument();
    });

    it('should show snapshot recall controls when the patch contains stored snapshots', () => {
        grinderStore.set({
            [device_id]: {
                patch: {
                    ...DEFAULT_PATCH,
                    snapshots: [
                        { id: 'clean', name: 'Clean', paramOverrides: { gain: 3 }, bypassStates: { od1: false } },
                        { id: 'drive', name: 'Drive', paramOverrides: { gain: 7 }, bypassStates: { od1: true } },
                    ],
                    activeSnapshot: 1,
                },
            },
        });

        render(<GrinderPanel deviceId={device_id} />);

        expect(screen.getByText('Snapshots')).toBeInTheDocument();
        const snapshots_section = screen.getByText('Snapshots').parentElement;

        expect(snapshots_section).not.toBeNull();
        expect(within(snapshots_section as HTMLElement).getByRole('button', { name: 'Clean' })).toBeInTheDocument();
        expect(within(snapshots_section as HTMLElement).getByRole('button', { name: 'Drive' })).toHaveAttribute(
            'aria-pressed',
            'true'
        );
    });
});
