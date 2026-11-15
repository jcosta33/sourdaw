import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { type AutomationLane, automationStore } from '#/modules/Automation/stores';
import {
    defaultExternalPluginActivationState,
    defaultExternalPluginParameterState,
    defaultExternalPluginRestoreFailureState,
    defaultPluginScanState,
    type ExternalPluginActivationStatus,
    type ExternalPluginParameter,
    externalPluginActivationStore,
    externalPluginParameterStore,
    externalPluginRestoreFailureStore,
    pluginScanStore,
} from '#/modules/PluginHost/stores';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';

import { type Device } from '../../../../models/TrackViewTypes';
import { ExternalPluginParameterList } from '../ExternalPluginParameterList';

const mockEdit = vi.fn<(input: { instanceId: string; parameterId: number; value: number }) => Promise<void>>();
const mockRefresh = vi.fn<(instanceId: string) => Promise<void>>();
const mockHasRestoreFailure = vi.fn<(instanceId: string) => boolean>();
vi.mock('#/modules/PluginHost/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/PluginHost/useCases')>();
    return {
        ...actual,
        editExternalPluginParameter: (input: { instanceId: string; parameterId: number; value: number }) =>
            mockEdit(input),
        hasUnresolvedExternalPluginRestoreFailure: (instanceId: string) => mockHasRestoreFailure(instanceId),
        refreshExternalPluginParameters: (instanceId: string) => mockRefresh(instanceId),
    };
});

const mockReadApplied = vi.fn<(deviceId: string, parameterId: string) => number | undefined>();
/** The scheduler's write sequence the mocked read reports; a test bumps it to say the scheduler wrote. */
let mockWriteSequence = 1;
vi.mock('#/modules/Transport/useCases', async (importOriginal) => {
    const actual = await importOriginal<typeof import('#/modules/Transport/useCases')>();
    return {
        ...actual,
        readAppliedAutomationValue: (deviceId: string, parameterId: string) => {
            const value = mockReadApplied(deviceId, parameterId);
            return value === undefined ? undefined : { value, writeSequence: mockWriteSequence };
        },
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
        format?: string;
    } = {}
): void => {
    const { status = 'active', message, scanParameters, snapshot = true, format = 'clap' } = options;
    const scannedParameters: Pick<ScannedPlugin, 'parameters'> = {};
    if (scanParameters) {
        scannedParameters.parameters = scanParameters;
    }
    const activation: ExternalPluginActivationStatus = { status: status === 'none' ? 'active' : status };
    if (message) {
        activation.message = message;
    }
    pluginScanStore.set({
        ...defaultPluginScanState,
        scannedPlugins: [
            {
                id: PLUGIN_ID,
                name: 'Reverb',
                vendor: 'Vendor',
                format,
                category: 'effect',
                path: '/plugins/reverb.clap',
                version: '1.0',
                descriptor_id: 'com.vendor.reverb',
                num_inputs: 2,
                num_outputs: 2,
                num_parameters: parameters.length,
                has_custom_ui: true,
                ...scannedParameters,
            },
        ],
    });
    externalPluginActivationStore.set({
        byInstanceId: status === 'none' ? {} : { [INSTANCE_ID]: activation },
    });
    externalPluginParameterStore.set({
        byInstanceId: snapshot ? { [INSTANCE_ID]: { engineAttached: true, parameters } } : {},
    });
};

/** The promise the nth call to the edit stub returned. */
const sentPromise = (index: number): Promise<void> => {
    const result = mockEdit.mock.results[index];
    if (!result) {
        throw new Error(`The edit stub was not called ${String(index + 1)} times.`);
    }
    return result.value;
};

const moveStoreValue = (id: number, name: string, value: number): void => {
    externalPluginParameterStore.set({
        byInstanceId: {
            [INSTANCE_ID]: { engineAttached: true, parameters: [parameter({ id, name, value })] },
        },
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

const automationLane = (deviceId: string, parameterId: number, clipId?: string): AutomationLane => {
    const lane: AutomationLane = {
        id: `lane-${deviceId}-${String(parameterId)}`,
        trackId: 'track-1',
        parameterId: `${deviceId}:${String(parameterId)}`,
        parameterName: `Param ${String(parameterId)}`,
        points: [],
        objects: [],
        visible: true,
        enabled: true,
        collapsed: false,
        minValue: 0,
        maxValue: 1,
    };
    if (clipId !== undefined) {
        lane.clipId = clipId;
    }
    return lane;
};

const setPlaying = (isPlaying: boolean): void => {
    act(() => {
        transportStore.set({ ...defaultTransportState, isPlaying });
    });
};

type FrameCallback = (timestamp: number) => void;
let frameCallbacks = new Map<number, FrameCallback>();
let nextFrameId = 1;
let intersecting = true;
let observerCount = 0;

/** Runs every frame requested so far once, at the given timestamp. */
const runFrame = (timestamp: number): void => {
    const pending = [...frameCallbacks.values()];
    frameCallbacks = new Map();
    act(() => {
        for (const callback of pending) {
            callback(timestamp);
        }
    });
};

class StubIntersectionObserver {
    private readonly callback: IntersectionObserverCallback;

    constructor(callback: IntersectionObserverCallback) {
        observerCount++;
        this.callback = callback;
    }

    observe(target: Element): void {
        this.callback(
            [{ isIntersecting: intersecting, target } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
        );
    }

    disconnect(): void {}
    unobserve(): void {}
    takeRecords(): IntersectionObserverEntry[] {
        return [];
    }
}

describe('ExternalPluginParameterList', () => {
    beforeEach(() => {
        mockRefresh.mockReset();
        mockRefresh.mockResolvedValue();
        mockReadApplied.mockReset();
        mockWriteSequence = 1;
        frameCallbacks = new Map();
        nextFrameId = 1;
        intersecting = true;
        observerCount = 0;
        vi.stubGlobal('IntersectionObserver', StubIntersectionObserver);
        vi.stubGlobal('requestAnimationFrame', (callback: FrameCallback) => {
            const id = nextFrameId++;
            frameCallbacks.set(id, callback);
            return id;
        });
        vi.stubGlobal('cancelAnimationFrame', (id: number) => {
            frameCallbacks.delete(id);
        });
        mockEdit.mockReset();
        mockEdit.mockResolvedValue();
        mockHasRestoreFailure.mockReset();
        mockHasRestoreFailure.mockReturnValue(false);
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        automationStore.set({ lanes: [] });
        transportStore.set(defaultTransportState);
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

    it.each([
        { format: 'vst3', expected: '0.004' },
        { format: 'VST3', expected: '0.004' },
        { format: 'clap', expected: '0.004 Hz' },
    ])('shows the $format value as "$expected"', ({ format, expected }) => {
        seed([parameter({ id: 7, name: 'Band', value: 0.004, unit: 'Hz' })], { format });
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.getByRole('slider', { name: 'Band' })).toHaveAttribute('aria-valuetext', expected);
        expect(screen.getByText(expected)).toBeInTheDocument();
    });

    it.each([
        { total: 1, query: '', text: '1 parameter' },
        { total: 3, query: 'param 1', text: '1 of 3 parameters' },
        { total: 3, query: '', text: '3 parameters' },
    ])('reads "$text" for $total parameters filtered by "$query"', ({ total, query, text }) => {
        seed(
            Array.from({ length: total }, (_unused, index) => parameter({ id: index, name: `Param ${String(index)}` }))
        );
        render(<ExternalPluginParameterList device={device} />);
        if (query !== '') {
            fireEvent.change(screen.getByRole('searchbox', { name: 'Filter parameters' }), {
                target: { value: query },
            });
        }

        expect(screen.getByText(text)).toBeInTheDocument();
    });

    it('holds the requested value while the send is in flight and builds the next nudge on it', async () => {
        const settle: Array<{ reject: (error: Error) => void; promise: Promise<void> }> = [];
        mockEdit.mockImplementation(() => {
            let rejectSend: (error: Error) => void = () => {};
            const promise = new Promise<void>((_resolve, reject) => {
                rejectSend = reject;
            });
            settle.push({ reject: rejectSend, promise });
            return promise;
        });
        seed([parameter({ id: 7, name: 'Decay', value: 0.25 })]);
        render(<ExternalPluginParameterList device={device} />);
        const slider = screen.getByRole('slider', { name: 'Decay' });

        fireEvent.change(slider, { target: { value: '0.5' } });
        expect(slider).toHaveValue('0.5');
        expect(slider).toHaveAttribute('aria-valuetext', '0.500');

        fireEvent.change(slider, { target: { value: '0.6' } });
        expect(slider).toHaveValue('0.6');

        // The superseded send settling (and refusing) must not disturb the newer pending value.
        // Awaiting the rejected promise runs after the row's own handlers, which were attached first.
        await act(async () => {
            settle[0]?.reject(new Error('refused'));
            await settle[0]?.promise.catch(() => {});
        });
        expect(slider).toHaveValue('0.6');
        expect(screen.queryByText('The plugin refused this change.')).not.toBeInTheDocument();

        // The latest send is refused: the row reverts to the store value and says so.
        await act(async () => {
            settle[1]?.reject(new Error('refused'));
            await settle[1]?.promise.catch(() => {});
        });
        expect(slider).toHaveValue('0.25');
        expect(screen.getByText('The plugin refused this change.')).toBeInTheDocument();
    });

    it('keeps the newer pending value when an older send is accepted first', async () => {
        const sends: Array<{ resolve: () => void; promise: Promise<void> }> = [];
        mockEdit.mockImplementation(() => {
            let resolveSend: () => void = () => {};
            const promise = new Promise<void>((resolve) => {
                resolveSend = resolve;
            });
            sends.push({ resolve: resolveSend, promise });
            return promise;
        });
        seed([parameter({ id: 7, name: 'Decay', value: 0.25 })]);
        render(<ExternalPluginParameterList device={device} />);
        const slider = screen.getByRole('slider', { name: 'Decay' });
        fireEvent.change(slider, { target: { value: '0.5' } });
        fireEvent.change(slider, { target: { value: '0.6' } });

        await act(async () => {
            sends[0]?.resolve();
            await sends[0]?.promise;
        });

        expect(slider).toHaveValue('0.6');
    });

    it('drops the pending value once the latest send is accepted and the store has moved', async () => {
        let resolveSend: () => void = () => {};
        let sent: Promise<void> = Promise.resolve();
        mockEdit.mockImplementation(() => {
            sent = new Promise<void>((resolve) => {
                resolveSend = resolve;
            });
            return sent;
        });
        seed([parameter({ id: 7, name: 'Decay', value: 0.25 })]);
        render(<ExternalPluginParameterList device={device} />);
        const slider = screen.getByRole('slider', { name: 'Decay' });

        fireEvent.change(slider, { target: { value: '0.5' } });
        await act(async () => {
            moveStoreValue(7, 'Decay', 0.5);
            resolveSend();
            await sent;
        });
        expect(slider).toHaveValue('0.5');
        expect(screen.queryByText('The plugin refused this change.')).not.toBeInTheDocument();

        // With the pending value dropped, the row follows the store again.
        act(() => {
            moveStoreValue(7, 'Decay', 0.9);
        });
        expect(slider).toHaveValue('0.9');
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

    it('shows a switch as checked at the range maximum and unchecked at the minimum', () => {
        seed([parameter({ id: 3, name: 'Freeze', value: 0 })], {
            scanParameters: [scanRow(3, { is_stepped: true })],
        });
        render(<ExternalPluginParameterList device={device} />);

        act(() => {
            moveStoreValue(3, 'Freeze', 1);
        });
        expect(screen.getByRole('switch', { name: 'Freeze' })).toBeChecked();

        act(() => {
            moveStoreValue(3, 'Freeze', 0);
        });
        expect(screen.getByRole('switch', { name: 'Freeze' })).not.toBeChecked();
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

    it('returns to one page when a filter that still matches many rows replaces a longer page', () => {
        seed(Array.from({ length: 200 }, (_unused, index) => parameter({ id: index, name: `Band ${String(index)}` })));
        render(<ExternalPluginParameterList device={device} />);
        fireEvent.click(screen.getByRole('button', { name: 'Show more' }));
        expect(screen.getAllByRole('slider')).toHaveLength(100);

        fireEvent.change(screen.getByRole('searchbox', { name: 'Filter parameters' }), {
            target: { value: 'band' },
        });

        expect(screen.getAllByRole('slider')).toHaveLength(50);
    });

    it('moves focus to the first revealed control when Show more is used', () => {
        seed(Array.from({ length: 60 }, (_unused, index) => parameter({ id: index, name: `Param ${String(index)}` })));
        render(<ExternalPluginParameterList device={device} />);
        const showMore = screen.getByRole('button', { name: 'Show more' });
        showMore.focus();

        fireEvent.click(showMore);

        expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
        expect(document.activeElement).toBe(screen.getByRole('slider', { name: 'Param 50' }));
    });

    it('shows an inline error on the row when the plugin refuses the change', async () => {
        mockEdit.mockRejectedValue(new Error('refused'));
        seed([parameter({ id: 7, name: 'Decay' }), parameter({ id: 8, name: 'Mix' })]);
        render(<ExternalPluginParameterList device={device} />);

        await act(async () => {
            fireEvent.change(screen.getByRole('slider', { name: 'Decay' }), { target: { value: '0.75' } });
            await sentPromise(0).catch(() => {});
        });

        const row = screen.getByTestId('external-parameter-7');
        expect(within(row).getByText('The plugin refused this change.')).toBeInTheDocument();
        expect(within(screen.getByTestId('external-parameter-8')).queryByRole('status')).not.toBeInTheDocument();
        expect(screen.getByRole('slider', { name: 'Decay' })).toHaveValue('0.25');
    });

    it('announces a refusal in a live region that exists before any edit, and clears it on the next edit', async () => {
        mockEdit.mockRejectedValueOnce(new Error('refused'));
        seed([parameter({ id: 7, name: 'Decay' })]);
        render(<ExternalPluginParameterList device={device} />);
        const region = screen.getByTestId('parameter-announcements');
        expect(region).toHaveAttribute('role', 'status');
        expect(region).toHaveTextContent('');

        await act(async () => {
            fireEvent.change(screen.getByRole('slider', { name: 'Decay' }), { target: { value: '0.75' } });
            await sentPromise(0).catch(() => {});
        });
        expect(screen.getByTestId('parameter-announcements')).toBe(region);
        expect(region).toHaveTextContent('Decay: The plugin refused this change.');
        expect(screen.getByText('The plugin refused this change.')).toBeInTheDocument();

        await act(async () => {
            fireEvent.change(screen.getByRole('slider', { name: 'Decay' }), { target: { value: '0.8' } });
            await sentPromise(1);
        });
        expect(screen.queryByText('The plugin refused this change.')).not.toBeInTheDocument();
        expect(region).toHaveTextContent('');
    });

    it('warns that edits will not be saved while the state restore failure stands', () => {
        mockHasRestoreFailure.mockReturnValue(true);
        seed([parameter({ id: 7, name: 'Decay' })]);
        render(<ExternalPluginParameterList device={device} />);

        expect(screen.getByText(/will not be saved with the project/)).toBeInTheDocument();
    });

    it('shows the restore warning without remounting when the failure is marked while the list is open', () => {
        seed([parameter({ id: 7, name: 'Decay' })]);
        render(<ExternalPluginParameterList device={device} />);
        expect(screen.queryByText(/will not be saved with the project/)).not.toBeInTheDocument();

        // The marker set is plain memory; production announces a change by bumping the store's version.
        act(() => {
            mockHasRestoreFailure.mockReturnValue(true);
            externalPluginRestoreFailureStore.update((state) => ({
                version: (state ?? defaultExternalPluginRestoreFailureState).version + 1,
            }));
        });

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

    describe('following automation', () => {
        const seedAutomated = (): void => {
            seed([parameter({ id: 7, name: 'Decay', value: 0.25 }), parameter({ id: 8, name: 'Mix', value: 0.25 })]);
            automationStore.set({ lanes: [automationLane(device.id, 7)] });
        };

        it('marks only a parameter that a lane on this device drives', () => {
            seed([
                parameter({ id: 7, name: 'Decay' }),
                parameter({ id: 8, name: 'Mix' }),
                parameter({ id: 9, name: 'Size' }),
            ]);
            automationStore.set({
                lanes: [automationLane(device.id, 7, 'clip-1'), automationLane('other-device', 8)],
            });
            render(<ExternalPluginParameterList device={device} />);

            expect(screen.getByTestId('external-parameter-7')).toHaveAttribute('data-automated', 'true');
            expect(screen.getByRole('slider', { name: 'Decay' })).toHaveAccessibleDescription('Automated');
            for (const [id, name] of [
                [8, 'Mix'],
                [9, 'Size'],
            ] as const) {
                expect(screen.getByTestId(`external-parameter-${String(id)}`)).not.toHaveAttribute('data-automated');
                expect(screen.getByRole('slider', { name })).not.toHaveAccessibleDescription('Automated');
            }
        });

        it('moves an automated row with the delivered value without announcing each step', () => {
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            const slider = screen.getByRole('slider', { name: 'Decay' });

            runFrame(0);
            expect(slider).toHaveValue('0.5');
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');
            expect(within(screen.getByTestId('external-parameter-7')).getByText('0.500')).toBeInTheDocument();
            expect(mockReadApplied).toHaveBeenCalledWith(device.id, '7');

            mockReadApplied.mockReturnValue(0.75);
            runFrame(10);
            expect(slider).toHaveValue('0.5');

            runFrame(50);
            expect(slider).toHaveValue('0.75');
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');
            expect(within(screen.getByTestId('external-parameter-7')).getByText('0.750')).toBeInTheDocument();
        });

        it('does not read or move a row that is scrolled out of view', () => {
            seedAutomated();
            setPlaying(true);
            intersecting = false;
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);

            runFrame(0);
            runFrame(50);

            expect(mockReadApplied).not.toHaveBeenCalledWith(device.id, '7');
            expect(screen.getByRole('slider', { name: 'Decay' })).toHaveValue('0.25');
        });

        it('never reads for an unautomated row', () => {
            seed([parameter({ id: 7, name: 'Decay', value: 0.25 })]);
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);

            runFrame(0);
            runFrame(50);

            expect(mockReadApplied).not.toHaveBeenCalled();
            expect(screen.getByRole('slider', { name: 'Decay' })).toHaveValue('0.25');
        });

        it('re-reads the plugin on stop and holds the last followed value until the parameters are replaced', () => {
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);
            expect(mockRefresh).not.toHaveBeenCalled();

            setPlaying(false);

            expect(mockRefresh).toHaveBeenCalledExactlyOnceWith(INSTANCE_ID);
            const slider = screen.getByRole('slider', { name: 'Decay' });
            expect(slider).toHaveValue('0.5');
            expect(slider).toHaveAttribute('aria-valuetext', '0.500');

            act(() => {
                moveStoreValue(7, 'Decay', 0.8);
            });
            expect(slider).toHaveValue('0.8');
            expect(slider).toHaveAttribute('aria-valuetext', '0.800');
        });

        it('never publishes a followed value as a plugin edit', () => {
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);

            runFrame(0);
            mockReadApplied.mockReturnValue(0.75);
            runFrame(50);
            setPlaying(false);

            expect(screen.getByRole('slider', { name: 'Decay' })).toHaveValue('0.75');
            expect(mockEdit).not.toHaveBeenCalled();
        });

        it('sends a user edit on an automated row and shows it while the send is pending, then follows again', async () => {
            let resolveSend: () => void = () => {};
            let sent: Promise<void> = Promise.resolve();
            mockEdit.mockImplementation(() => {
                sent = new Promise<void>((resolve) => {
                    resolveSend = resolve;
                });
                return sent;
            });
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);
            const slider = screen.getByRole('slider', { name: 'Decay' });

            fireEvent.change(slider, { target: { value: '0.9' } });

            expect(mockEdit).toHaveBeenCalledExactlyOnceWith({ instanceId: INSTANCE_ID, parameterId: 7, value: 0.9 });
            expect(slider).toHaveValue('0.9');
            expect(slider).toHaveAttribute('aria-valuetext', '0.900');

            await act(async () => {
                resolveSend();
                await sent;
            });
            expect(slider).toHaveValue('0.5');
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');
        });

        it('shows the real value once a lane stops delivering, keeping the last delivered number', () => {
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);
            const slider = screen.getByRole('slider', { name: 'Decay' });
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');

            mockReadApplied.mockReturnValue(undefined);
            runFrame(50);

            expect(slider).toHaveValue('0.5');
            expect(slider).toHaveAttribute('aria-valuetext', '0.500');
        });

        it('shows the value the scheduler rewrites on the next play over an edit made while stopped', () => {
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);
            setPlaying(false);

            act(() => {
                moveStoreValue(7, 'Decay', 0.9);
            });
            const slider = screen.getByRole('slider', { name: 'Decay' });
            expect(slider).toHaveValue('0.9');

            // Play start rewrites the flat lane's 0.5 into the plugin: same number, new write.
            mockWriteSequence = 2;
            setPlaying(true);
            runFrame(50);

            expect(slider).toHaveValue('0.5');
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');
        });

        it('keeps an accepted user edit over an unchanged delivered value until the lane moves', async () => {
            let resolveSend: () => void = () => {};
            let sent: Promise<void> = Promise.resolve();
            mockEdit.mockImplementation(() => {
                sent = new Promise<void>((resolve) => {
                    resolveSend = resolve;
                });
                return sent;
            });
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);
            const slider = screen.getByRole('slider', { name: 'Decay' });

            fireEvent.change(slider, { target: { value: '0.9' } });
            await act(async () => {
                moveStoreValue(7, 'Decay', 0.9);
                resolveSend();
                await sent;
            });
            runFrame(50);
            runFrame(100);
            expect(slider).toHaveValue('0.9');
            expect(slider).toHaveAttribute('aria-valuetext', '0.900');

            mockReadApplied.mockReturnValue(0.6);
            mockWriteSequence = 2;
            runFrame(150);
            runFrame(200);
            expect(slider).toHaveValue('0.6');
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');
        });

        it('keeps the followed value when an unrelated parameter is patched', () => {
            const decay = parameter({ id: 7, name: 'Decay', value: 0.25 });
            const mix = parameter({ id: 8, name: 'Mix', value: 0.25 });
            seed([decay, mix]);
            automationStore.set({ lanes: [automationLane(device.id, 7)] });
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.5);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);

            act(() => {
                externalPluginParameterStore.set({
                    byInstanceId: {
                        [INSTANCE_ID]: { engineAttached: true, parameters: [decay, { ...mix, value: 0.9 }] },
                    },
                });
            });
            runFrame(50);

            const slider = screen.getByRole('slider', { name: 'Decay' });
            expect(slider).toHaveValue('0.5');
            expect(slider).toHaveAttribute('aria-valuetext', 'Following automation');
            expect(screen.getByRole('slider', { name: 'Mix' })).toHaveValue('0.9');
        });

        it('holds the followed value and re-reads the plugin when the last lane is removed', () => {
            seedAutomated();
            setPlaying(true);
            mockReadApplied.mockReturnValue(0.8);
            render(<ExternalPluginParameterList device={device} />);
            runFrame(0);
            setPlaying(false);
            expect(mockRefresh).toHaveBeenCalledTimes(1);

            act(() => {
                automationStore.set({ lanes: [] });
            });

            const slider = screen.getByRole('slider', { name: 'Decay' });
            expect(slider).toHaveValue('0.8');
            expect(mockRefresh).toHaveBeenCalledTimes(2);

            act(() => {
                moveStoreValue(7, 'Decay', 0.3);
            });
            expect(slider).toHaveValue('0.3');
        });

        it('never re-reads a plugin that never had automation when playback starts and stops', () => {
            seed([parameter({ id: 7, name: 'Decay', value: 0.25 })]);
            render(<ExternalPluginParameterList device={device} />);

            setPlaying(true);
            setPlaying(false);

            expect(mockRefresh).not.toHaveBeenCalled();
        });

        it('observes visibility only for automated rows', () => {
            seed([
                parameter({ id: 7, name: 'Decay' }),
                parameter({ id: 8, name: 'Mix' }),
                parameter({ id: 9, name: 'Size' }),
            ]);
            automationStore.set({ lanes: [automationLane(device.id, 7)] });
            render(<ExternalPluginParameterList device={device} />);

            expect(observerCount).toBe(1);
        });
    });
});
