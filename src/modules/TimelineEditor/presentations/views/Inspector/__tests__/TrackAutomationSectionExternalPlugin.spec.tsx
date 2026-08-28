import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginParameterState,
    type ExternalPluginParameter,
    externalPluginParameterStore,
} from '#/modules/PluginHost/stores';

import { TrackAutomationSection } from '../TrackAutomationSection';

import type { Track } from '../../../../models/TrackViewTypes';

/**
 * The external-plugin half of the inspector's automation menu, wired to the real
 * `externalPluginParameterStore` rather than a blanket `useStore` stub.
 *
 * The sibling `TrackAutomationSection.spec.tsx` mocks `useStore` to answer
 * `{ lanes: [] }` for every store it is handed, which makes the plugin-parameter
 * subscription unobservable there — the menu would render identically with the
 * subscription deleted. This file keeps the stores real so the wiring is what is
 * under test: the subscription that redraws on a late snapshot, the refresh the
 * menu fires on open, and the instance id threaded into descriptor resolution.
 */

const mocks = vi.hoisted(() => ({ refreshExternalPluginParameters: vi.fn(() => Promise.resolve()) }));
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/PluginHost/useCases')>()),
    refreshExternalPluginParameters: mocks.refreshExternalPluginParameters,
}));

vi.mock('#/components/daw/DawEmptyState', () => ({
    DawEmptyState: ({ title }: { title: string }) => <div data-testid="empty-state">{title}</div>,
}));

vi.mock('#/components/daw/DawHeaderBand', () => ({
    DawHeaderBand: ({ title, actions }: { title?: string; actions?: React.ReactNode }) => (
        <div data-testid="header-band">
            <span>{title}</span>
            {actions ? <div data-testid="header-actions">{actions}</div> : null}
        </div>
    ),
}));

vi.mock('#/components/daw/DawMenuParts', () => ({
    DawMenuSectionLabel: ({ children }: { children: React.ReactNode }) => (
        <div data-testid="menu-label">{children}</div>
    ),
    DawMenuSeparator: () => <hr data-testid="menu-separator" />,
}));

vi.mock('#/components/ui/button', () => ({
    Button: ({
        children,
        variant,
        size,
        asChild: _asChild,
        ...props
    }: React.ComponentProps<'button'> & { variant?: string; size?: string; asChild?: boolean }) => (
        <button type="button" data-testid="button" data-variant={variant} data-size={size} {...props}>
            {children}
        </button>
    ),
}));

vi.mock('../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

const INSTANCE_ID = 'inst-console';

function externalParameter(overrides: Partial<ExternalPluginParameter> = {}): ExternalPluginParameter {
    return {
        id: 7,
        name: 'Drive',
        value: 0,
        defaultValue: 0,
        minValue: -12,
        maxValue: 24,
        unit: 'dB',
        isAutomatable: true,
        ...overrides,
    };
}

function publishSnapshot(engineAttached: boolean, parameters: ExternalPluginParameter[]): void {
    act(() => {
        externalPluginParameterStore.set({ byInstanceId: { [INSTANCE_ID]: { engineAttached, parameters } } });
    });
}

const pluginTrack: Track = {
    id: 'track-1',
    name: 'Test Track',
    kind: 'audio',
    muted: false,
    soloed: false,
    armed: false,
    gain: 1,
    pan: 0,
    color: '#ff0000',
    clips: [],
    devices: [
        {
            id: 'device-plugin',
            name: 'Console',
            type: 'external-plugin',
            bypassed: false,
            // Empty, as `addExternalDevice` creates it: the menu must resolve
            // targets from the instance's own declaration.
            parameterValues: {},
            externalPluginId: 'plugin-a',
            externalInstanceId: INSTANCE_ID,
        },
    ],
    midiFx: [],
    sends: [],
    frozen: false,
    freezeState: { status: 'unfrozen' },
    parentId: null,
    collapsed: false,
    inputMonitoring: 'auto',
    hidden: false,
    disabled: false,
    height: 100,
    outputId: 'master',
    automationMode: 'read',
    groupId: null,
    soloSafe: false,
    notes: '',
    inputId: null,
    activeAlternativeId: 'alt-1',
    alternatives: [],
    vcaGroupId: null,
    midiOutputTrackId: null,
    followChordTrack: false,
};

function openAutomationMenu(): void {
    fireEvent.click(screen.getByLabelText(/Add automation lane/i));
}

describe('TrackAutomationSection with an external plugin device', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
    });

    it('redraws the open menu when the instance publishes its parameters', () => {
        render(<TrackAutomationSection track={pluginTrack} />);
        openAutomationMenu();

        // Nothing published yet: the menu has no plugin targets to offer.
        expect(screen.queryByText('Drive')).not.toBeInTheDocument();

        publishSnapshot(true, [externalParameter()]);

        expect(screen.getByText('Drive')).toBeInTheDocument();
    });

    it('re-reads the instance metadata when the menu opens', () => {
        publishSnapshot(true, [externalParameter()]);
        render(<TrackAutomationSection track={pluginTrack} />);

        expect(mocks.refreshExternalPluginParameters).not.toHaveBeenCalled();

        openAutomationMenu();

        expect(mocks.refreshExternalPluginParameters).toHaveBeenCalledWith(INSTANCE_ID);
    });

    it('offers no target for a parameter the plugin declares non-automatable', () => {
        publishSnapshot(true, [
            externalParameter({ id: 7, name: 'Drive' }),
            externalParameter({ id: 8, name: 'Bypass', isAutomatable: false }),
        ]);
        render(<TrackAutomationSection track={pluginTrack} />);
        openAutomationMenu();

        expect(screen.getByText('Drive')).toBeInTheDocument();
        expect(screen.queryByText('Bypass')).not.toBeInTheDocument();
    });

    it('offers no plugin targets while the instance is not attached to the engine', () => {
        publishSnapshot(false, [externalParameter()]);
        render(<TrackAutomationSection track={pluginTrack} />);
        openAutomationMenu();

        // A write to an unattached instance reaches no DSP, so the whole device
        // section is withheld rather than offering a ride nothing performs.
        expect(screen.queryByText('Drive')).not.toBeInTheDocument();
        expect(screen.queryByText('Console')).not.toBeInTheDocument();
    });
});
