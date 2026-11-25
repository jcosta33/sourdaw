import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';

import { getPluginById } from '#/modules/Arrangement/useCases';
import { dynamicsCompressorHiddenMakeupDb } from '#/utils/dynamicsCompressorMakeupLaw';

import type { DeviceParameterView } from '../../../../../models/PluginDescriptorViewTypes';
import type { Device } from '../../../../../models/TrackViewTypes';
import type { DeviceLayoutProps } from '../../deviceLayoutRegistry';

const { mockRegisterDeviceLayout } = vi.hoisted(() => ({
    mockRegisterDeviceLayout: vi.fn(),
}));
vi.mock('../../deviceLayoutRegistry', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../deviceLayoutRegistry')>();
    return {
        ...actual,
        registerDeviceLayout: (...args: unknown[]) => mockRegisterDeviceLayout(...args),
    };
});

const mockCompressorCurve = vi.fn((_props: unknown) => <div data-testid="compressor-curve" />);
vi.mock('#/components/daw/visualizers/CompressorCurve', () => ({
    CompressorCurve: (props: unknown) => mockCompressorCurve(props),
}));

vi.mock('#/modules/Arrangement/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/Arrangement/useCases')>()),
    setDeviceParameter: vi.fn(),
}));

vi.mock('../../../../components/Inspector/SurfaceCard', () => ({
    SurfaceCard: ({ children }: { children: React.ReactNode }) => <div data-testid="surface-card">{children}</div>,
}));

vi.mock('../../DeviceParameterControl', () => ({
    DeviceParameterControl: ({ param }: { param: { id: string } }) => <div data-testid="param-control">{param.id}</div>,
}));

vi.mock('../../SectionHeader', () => ({
    SectionHeader: ({ title }: { title: string }) => <div>{title}</div>,
}));

const PARAM_IDS = [
    'comp-threshold',
    'comp-ratio',
    'comp-attack',
    'comp-release',
    'comp-knee',
    'comp-makeup',
    'comp-auto-makeup',
];

const makeParam = (id: string): DeviceParameterView => {
    const deviceType = id.startsWith('sc-comp-') ? 'builtin-sidechain-compressor' : 'builtin-compressor';
    const parameter = getPluginById(deviceType)?.parameters.find((candidate) => candidate.id === id);
    if (!parameter) {
        throw new Error(`Missing real ${deviceType}/${id} descriptor`);
    }
    return parameter;
};

const makeDevice = (overrides: Partial<Device> = {}): Device => ({
    id: 'device-1',
    name: 'Compressor',
    type: 'builtin-compressor',
    bypassed: false,
    parameterValues: {},
    ...overrides,
});

describe('CompressorLayout', () => {
    let Layout: React.ComponentType<DeviceLayoutProps>;

    beforeAll(async () => {
        await import('../CompressorLayout');
        const firstCall = mockRegisterDeviceLayout.mock.calls[0];
        if (!firstCall) {
            throw new Error('expected registerDeviceLayout to have been called');
        }
        Layout = firstCall[1] as React.ComponentType<DeviceLayoutProps>;
    });

    it('registers the layout for builtin-compressor and builtin-sidechain-compressor', () => {
        expect(mockRegisterDeviceLayout).toHaveBeenCalledWith(
            ['builtin-compressor', 'builtin-sidechain-compressor'],
            expect.any(Function)
        );
    });

    it('renders every compressor parameter in the grid, the Auto Makeup switch last', () => {
        render(<Layout device={makeDevice()} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);
        const ids = screen.getAllByTestId('param-control').map((el) => el.textContent);
        expect(ids).toEqual(PARAM_IDS);
    });

    it('passes threshold/ratio/knee/makeup defaults to CompressorCurve for a new device, Auto Makeup off', () => {
        render(
            <Layout
                device={makeDevice({ parameterValues: { 'comp-auto-makeup': 0 } })}
                trackId="track-1"
                parameters={PARAM_IDS.map(makeParam)}
            />
        );
        expect(mockCompressorCurve).toHaveBeenCalledWith(
            expect.objectContaining({
                threshold: -20,
                ratio: 4,
                knee: 6,
                makeup: 0,
            })
        );
    });

    it('passes live parameterValues to CompressorCurve when set', () => {
        const device = makeDevice({
            parameterValues: {
                'comp-threshold': -12,
                'comp-ratio': 8,
                'comp-knee': 3,
                'comp-makeup': 4,
                'comp-auto-makeup': 0,
            },
        });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);
        expect(mockCompressorCurve).toHaveBeenCalledWith(
            expect.objectContaining({
                threshold: -12,
                ratio: 8,
                knee: 3,
                makeup: 4,
            })
        );
    });

    it('renders every real sidechain parameter and uses its actual threshold family', () => {
        const parameters = getPluginById('builtin-sidechain-compressor')?.parameters;
        if (!parameters) {
            throw new Error('Missing real Sidechain Compressor descriptor');
        }
        render(
            <Layout
                device={makeDevice({ type: 'builtin-sidechain-compressor' })}
                trackId="track-1"
                parameters={parameters}
            />
        );
        expect(screen.getAllByTestId('param-control').map((element) => element.textContent)).toEqual([
            'sc-comp-threshold',
            'sc-comp-ratio',
            'sc-comp-attack',
            'sc-comp-release',
            'sc-comp-makeup',
        ]);
        expect(mockCompressorCurve).toHaveBeenLastCalledWith(
            expect.objectContaining({
                threshold: -20,
                ratio: 4,
                knee: 0,
                makeup: 0,
                onGestureStart: expect.any(Function),
                onGestureCommit: expect.any(Function),
                onGestureCancel: expect.any(Function),
            })
        );
    });

    it('reads only real sidechain values and keeps its characteristic hard knee', () => {
        const ids = ['sc-comp-threshold', 'sc-comp-ratio', 'sc-comp-attack', 'sc-comp-release', 'sc-comp-makeup'];
        render(
            <Layout
                device={makeDevice({
                    type: 'builtin-sidechain-compressor',
                    parameterValues: {
                        'sc-comp-threshold': -32,
                        'sc-comp-ratio': 9,
                        'sc-comp-makeup': 5,
                        'comp-threshold': -1,
                        'comp-ratio': 2,
                        'comp-knee': 12,
                        'comp-makeup': 20,
                    },
                })}
                trackId="track-1"
                parameters={ids.map(makeParam)}
            />
        );
        expect(mockCompressorCurve).toHaveBeenLastCalledWith(
            expect.objectContaining({
                threshold: -32,
                ratio: 9,
                knee: 0,
                makeup: 5,
            })
        );
        expect(screen.getAllByTestId('param-control')).toHaveLength(5);
    });

    it.each([
        ['on', { 'comp-auto-makeup': 1 }],
        ['absent, as a device stored before the switch', {}],
    ])('draws the browser makeup on top of Makeup when Auto Makeup is %s', (_label, switchValue) => {
        const device = makeDevice({
            parameterValues: {
                'comp-threshold': -30,
                'comp-ratio': 6,
                'comp-knee': 0,
                'comp-makeup': 2,
                ...switchValue,
            },
        });
        render(<Layout device={device} trackId="track-1" parameters={PARAM_IDS.map(makeParam)} />);
        const hidden = dynamicsCompressorHiddenMakeupDb({ thresholdDb: -30, kneeDb: 0, ratio: 6 });
        // Hard knee: 0.6 · 30 · (1 − 1/6) dB, independent of the knee search.
        expect(hidden).toBeCloseTo(15, 4);
        expect(mockCompressorCurve).toHaveBeenLastCalledWith(
            expect.objectContaining({ threshold: -30, ratio: 6, knee: 0, makeup: 2 + hidden })
        );
    });
});
