import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    defaultExternalPluginActivationState,
    defaultExternalPluginParameterState,
    defaultExternalPluginRestoreFailureState,
    defaultPluginScanState,
    type ExternalPluginParameter,
    externalPluginActivationStore,
    externalPluginParameterStore,
    externalPluginRestoreFailureStore,
    pluginScanStore,
} from '#/modules/PluginHost/stores';

import { type Device } from '../../../../models/TrackViewTypes';
import { ExternalPluginParameterList } from '../ExternalPluginParameterList';

const mockEdit = vi.fn<(input: { instanceId: string; parameterId: number; value: number }) => Promise<void>>();
const mockHasRestoreFailure = vi.fn<(instanceId: string) => boolean>();
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        editExternalPluginParameter: (input: { instanceId: string; parameterId: number; value: number }) =>
            mockEdit(input),
        hasUnresolvedExternalPluginRestoreFailure: (instanceId: string) => mockHasRestoreFailure(instanceId),
    };
});

const PLUGIN_ID = 'reverb-plugin';
const INSTANCE_ID = 'inst-1';

const device: Device = {
    id: 'device-ext',
    name: 'Reverb',
    type: 'external-plugin',
    bypassed: false,
    parameterValues: {},
    externalPluginId: PLUGIN_ID,
    externalInstanceId: INSTANCE_ID,
};

const parameter = (overrides: Partial<ExternalPluginParameter>): ExternalPluginParameter => ({
    id: 1,
    name: 'Param',
    value: 0.25,
    defaultValue: 0,
    minValue: 0,
    maxValue: 1,
    unit: '',
    isAutomatable: true,
    ...overrides,
});

type ScannedPlugin = (typeof defaultPluginScanState)['scannedPlugins'][number];

const seed = (
    parameters: readonly ExternalPluginParameter[],
    options: {
        status?: 'loading' | 'active' | 'error' | 'none';
        message?: string;
        scanParameters?: ScannedPlugin['parameters'];
        snapshot?: boolean;
    } = {}
): void => {
    const { status = 'active', message, scanParameters, snapshot = true } = options;
    pluginScanStore.set({
        ...defaultPluginScanState,
        scannedPlugins: [
            {
                id: PLUGIN_ID,
                name: 'Reverb',
                vendor: 'Vendor',
                format: 'clap',
                category: 'effect',
                path: '/plugins/reverb.clap',
                version: '1.0',
                descriptor_id: 'com.vendor.reverb',
                num_inputs: 2,
                num_outputs: 2,
                num_parameters: parameters.length,
                has_custom_ui: true,
                ...(scanParameters ? { parameters: scanParameters } : {}),
            },
        ],
    });
    externalPluginActivationStore.set({
        byInstanceId: status === 'none' ? {} : { [INSTANCE_ID]: { status, ...(message ? { message } : {}) } },
    });
    externalPluginParameterStore.set({
        byInstanceId: snapshot ? { [INSTANCE_ID]: { engineAttached: true, parameters } } : {},
    });
};

const scanRow = (id: number, flags: { is_stepped?: boolean; is_enum?: boolean }) => ({
    id,
    name: `P${String(id)}`,
    min_value: 0,
    max_value: 1,
    default_value: 0,
    is_automatable: true,
    is_modulatable: false,
    is_stepped: flags.is_stepped ?? false,
    is_enum: flags.is_enum ?? false,
});

describe('ExternalPluginParameterList', () => {
    beforeEach(() => {
        mockEdit.mockReset();
        mockEdit.mockResolvedValue();
        mockHasRestoreFailure.mockReset();
        mockHasRestoreFailure.mockReturnValue(false);
    });

    afterEach(() => {
        pluginScanStore.set(defaultPluginScanState);
        externalPluginActivationStore.set(defaultExternalPluginActivationState);
        externalPluginParameterStore.set(defaultExternalPluginParameterState);
        externalPluginRestoreFailureStore.set(defaultExternalPluginRestoreFailureState);
    });

    it('renders a slider with the parameter name and value text as its accessible name and value', () => {
        seed([parameter({ id: 7, name: 'Decay', value: 0.5, unit: 's' })]);
        render(<ExternalPluginParameterList device={device} />);

        const slider = screen.getByRole('slider', { name: 'Decay' });
        expect(slider).toHaveAttribute('aria-valuetext', '0.500 s');
        expect(slider).toHaveAttribute('min', '0');
        expect(slider).toHaveAttribute('max', '1');
        expect(slider).toHaveValue('0.5');
    });

    it('sends the keyed value of a slider change to the plugin', () => {
        seed([parameter({ id: 7, name: 'Decay' })]);
        render(<ExternalPluginParameterList device={device} />);

        fireEvent.change(screen.getByRole('slider', { name: 'Decay' }), { target: { value: '0.75' } });

        expect(mockEdit).toHaveBeenCalledExactlyOnceWith({ instanceId: INSTANCE_ID, parameterId: 7, value: 0.75 });
    });

    it('renders a stepped two-value parameter as a switch that sends its range ends', () => {
        seed([parameter({ id: 3, name: 'Freeze', value: 0 })], {
            scanParameters: [scanRow(3, { is_stepped: true })],
        });
        render(<ExternalPluginParameterList device={device} />);

        const toggle = screen.getByRole('switch', { name: 'Freeze' });
        expect(toggle).not.toBeChecked();
        fireEvent.click(toggle);

        expect(mockEdit).toHaveBeenCalledExactlyOnceWith({ instanceId: INSTANCE_ID, parameterId: 3, value: 1 });
        expect(screen.queryByRole('slider', { name: 'Freeze' })).not.toBeInTheDocument();
    });

    it('steps a stepped multi-value parameter by whole values', () => {
        seed([parameter({ id: 4, name: 'Mode', value: 2, maxValue: 7 })], {
            scanParameters: [scanRow(4, { is_enum: true })],
        });
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.getByRole('slider', { name: 'Mode' })).toHaveAttribute('step', '1');
    });

    it('shows a value patched into the store, as a vendor-editor edit would', () => {
        seed([parameter({ id: 7, name: 'Decay', value: 0.25 })]);
        render(<ExternalPluginParameterList device={device} />);

        act(() => {
            externalPluginParameterStore.set({
                byInstanceId: {
                    [INSTANCE_ID]: {
                        engineAttached: true,
                        parameters: [parameter({ id: 7, name: 'Decay', value: 0.9 })],
                    },
                },
            });
        });

        expect(screen.getByRole('slider', { name: 'Decay' })).toHaveValue('0.9');
        expect(screen.getByRole('slider', { name: 'Decay' })).toHaveAttribute('aria-valuetext', '0.900');
    });

    it('follows a rescan that replaces the parameter list', () => {
        seed([parameter({ id: 1, name: 'Old' })]);
        render(<ExternalPluginParameterList device={device} />);

        act(() => {
            externalPluginParameterStore.set({
                byInstanceId: {
                    [INSTANCE_ID]: { engineAttached: true, parameters: [parameter({ id: 2, name: 'New' })] },
                },
            });
        });

        expect(screen.getByRole('slider', { name: 'New' })).toBeInTheDocument();
        expect(screen.queryByRole('slider', { name: 'Old' })).not.toBeInTheDocument();
    });

    it('mounts one page of a 2,000-parameter plugin and adds the next on Show more', () => {
        seed(
            Array.from({ length: 2000 }, (_unused, index) => parameter({ id: index, name: `Param ${String(index)}` }))
        );
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.getAllByRole('slider')).toHaveLength(50);
        expect(screen.getByText('2000 parameters')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));

        expect(screen.getAllByRole('slider')).toHaveLength(100);
    });

    it('narrows the list by name, reports the count, and returns to the first page when the filter changes', () => {
        seed(Array.from({ length: 200 }, (_unused, index) => parameter({ id: index, name: `Band ${String(index)}` })));
        render(<ExternalPluginParameterList device={device} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
        expect(screen.getAllByRole('slider')).toHaveLength(100);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Filter parameters' }), {
            target: { value: 'band 19' },
        });

        // "Band 19" and "Band 190".."Band 199"
        expect(screen.getAllByRole('slider')).toHaveLength(11);
        expect(screen.getByText('11 of 200 parameters')).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    });

    it('shows an inline error on the row when the plugin refuses the change', async () => {
        mockEdit.mockRejectedValue(new Error('refused'));
        seed([parameter({ id: 7, name: 'Decay' }), parameter({ id: 8, name: 'Mix' })]);
        render(<ExternalPluginParameterList device={device} />);

        await act(async () => {
            fireEvent.change(screen.getByRole('slider', { name: 'Decay' }), { target: { value: '0.75' } });
            await Promise.resolve();
        });

        const row = screen.getByTestId('external-parameter-7');
        expect(await within(row).findByText('The plugin refused this change.')).toBeInTheDocument();
        expect(within(screen.getByTestId('external-parameter-8')).queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Decay' })).toHaveValue('0.25');
    });

    it('warns that edits will not be saved while the state restore failure stands', () => {
        mockHasRestoreFailure.mockReturnValue(true);
        seed([parameter({ id: 7, name: 'Decay' })]);
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.getByText(/will not be saved with the project/)).toBeInTheDocument();
    });

    it('shows no restore warning for a healthy instance', () => {
        seed([parameter({ id: 7, name: 'Decay' })]);
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.queryByText(/will not be saved with the project/)).not.toBeInTheDocument();
    });

    it.each([
        {
            name: 'loading',
            options: { status: 'loading' as const, snapshot: false },
            text: 'Loading this plugin...',
        },
        {
            name: 'failed',
            options: { status: 'error' as const, message: 'bad binary', snapshot: false },
            text: 'This plugin failed to load: bad binary',
        },
        {
            name: 'not loaded',
            options: { status: 'none' as const, snapshot: false },
            text: 'This plugin is not loaded, so its parameters are not listed.',
        },
        {
            name: 'parameterless',
            options: { status: 'active' as const },
            text: 'This plugin reports no parameters.',
        },
    ])('shows why nothing is listed for a $name plugin', ({ options, text }) => {
        seed([], options);
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.getByText(text)).toBeInTheDocument();
        expect(screen.queryByRole('slider')).not.toBeInTheDocument();
        expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
    });
});
