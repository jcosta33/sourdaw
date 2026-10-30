import { clone, getObjectId } from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, type Track } from '#/modules/Arrangement/stores';
import { createTrack, getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import { executeAppAction } from '#/modules/Command/useCases';
import {
    captureProjectRootIdentity,
    createCrdtDoc,
    getCrdtDoc,
    mutateCrdtDoc,
    projectCrdtToStores,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    replaceCrdtDocInLineage,
    resetCrdtProjectAuthority,
    setupProjectionBridge,
} from '#/modules/CrdtDocument/useCases';
import { CrumbsPanel } from '#/modules/Crumbs/presentations/views';
import { initCrumbsDeviceStatePersistence, syncCrumbsNativeInstances } from '#/modules/Crumbs/useCases';
import { defaultProjectStoreState, projectStore } from '#/modules/Project/stores';

import { createCrumbsSampleProjectAccess } from '../createCrumbsSampleProjectAccess';
import { initDeviceStateReconciliation } from '../initDeviceStateReconciliation';

const native = vi.hoisted(() => ({
    invoke: vi.fn<SourdawDesktopBridge['invoke']>(() => Promise.resolve(undefined)),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: vi.fn(),
}));

type Root = { tracks: { tracks: Track[] } };
type Boundary = 'telemetry' | 'peaks';
type HeldNative = {
    boundary: Boundary;
    entered: PromiseWithResolvers<void>;
    response: PromiseWithResolvers<unknown>;
    consumed: boolean;
};

const FIRST_PEAKS = [-0.9, 0.8, -0.7, 0.6];
const SECOND_PEAKS = [-0.2, 0.3, -0.1, 0.4];
const TRACK = 'crumbs-app-track';
let fixtureSequence = 0;
let deviceId: string;
let held: HeldNative | undefined;
const modeWaiters = new Map<number, () => void>();
let panel: HTMLElement;
let paint: MockInstance<CanvasRenderingContext2D['fillRect']>;
let disposeReconciliation: () => void;
let disposeProjection: () => void;
let disposePersistence: () => void;
let disposeNative: () => void;
let desktopBridgeDescriptor: PropertyDescriptor | undefined;

function device(): Track['devices'][number] {
    return { id: deviceId, name: 'Crumbs', type: 'builtin-crumbs', bypassed: false, parameterValues: {} };
}

function root() {
    const document = getCrdtDoc<Root>('root');
    if (!document) {
        throw new Error('Expected the actual committed root');
    }
    return document;
}

function rawDevice() {
    const current = root().tracks.tracks.find((track) => track.id === TRACK)?.devices[0];
    if (!current) {
        throw new Error('Expected the committed Crumbs device');
    }
    return current;
}

function editDevices(edit: (devices: Track['devices']) => void): void {
    mutateCrdtDoc<Root>({
        id: 'root',
        changeFn: (document) => {
            const owner = document.tracks.tracks.find((track) => track.id === TRACK);
            if (!owner) {
                throw new Error('Expected the committed owner track');
            }
            edit(owner.devices);
        },
    });
}

function modeCompletions(): number {
    return native.invoke.mock.calls.filter(([command]) => command === 'set_crumbs_mode').length;
}

async function awaitModeCompletions(count: number): Promise<void> {
    if (modeCompletions() < count) {
        const settled = Promise.withResolvers<void>();
        modeWaiters.set(count, settled.resolve);
        await settled.promise;
    }
    expect(modeCompletions()).toBe(count);
}

function drop(path: string, target: HTMLElement = panel): void {
    const file = new File([new Uint8Array([0])], path.slice(1), { type: 'audio/wav' });
    Object.defineProperty(file, 'path', { value: path });
    fireEvent.drop(target, { dataTransfer: { files: [file] } });
}

async function beginHeldDrop(boundary: Boundary): Promise<HeldNative> {
    const request: HeldNative = {
        boundary,
        entered: Promise.withResolvers<void>(),
        response: Promise.withResolvers<unknown>(),
        consumed: false,
    };
    held = request;
    await act(async () => {
        drop('/a.wav');
        await request.entered.promise;
    });
    await waitFor(() =>
        expect(rawDevice().deviceState).toMatchObject({ data: { activeSample: { filePath: '/a.wav' } } })
    );
    expect(screen.getByText('a.wav', { exact: true })).toBeInTheDocument();
    return request;
}

async function finishCurrentDrop(path: string, count: number): Promise<void> {
    await act(async () => {
        drop(path);
        await awaitModeCompletions(count);
    });
    expect(screen.getByText(path.slice(1), { exact: true })).toBeInTheDocument();
}

function expectSecondWaveform(): void {
    const calls = paint.mock.calls.slice(-3);
    expect(calls).toHaveLength(3);
    expect(calls[0]).toEqual([0, 0, 240, 64]);
    expect(calls[1]?.[1]).toBeCloseTo(22.4);
    expect(calls[1]?.[3]).toBeCloseTo(16);
    expect(calls[2]?.[1]).toBeCloseTo(19.2);
}

beforeEach(async () => {
    desktopBridgeDescriptor = Object.getOwnPropertyDescriptor(window, 'sourdaw');
    Object.defineProperty(window, 'sourdaw', {
        configurable: true,
        value: { invoke: native.invoke } satisfies Pick<SourdawDesktopBridge, 'invoke'>,
    });
    deviceId = `crumbs-app-${++fixtureSequence}`;
    held = undefined;
    modeWaiters.clear();
    native.invoke.mockReset();
    native.invoke.mockImplementation(async (command, input) => {
        const sampleArgument = input?.[1];
        if (command === 'set_crumbs_mode') {
            modeWaiters.get(modeCompletions())?.();
            return undefined;
        }
        if (command === 'create_crumbs') {
            return { attached: true };
        }
        if (command === 'load_sample') {
            let sampleId = 2;
            if (sampleArgument === '/a.wav') {
                sampleId = 1;
            }
            return {
                sampleId,
                sampleRate: 48000,
                channels: 1,
                frameCount: sampleId * 1000,
                durationSecs: sampleId / 48,
                detectedRoot: 60,
                detectedBpm: null,
                category: 'tonal',
                decodeWarningCount: 0,
                decodeWarnings: [],
            };
        }
        const telemetry = command === 'get_crumbs_dropped_sample_writes';
        const peaks = command === 'get_waveform_peaks';
        if (
            held &&
            !held.consumed &&
            ((telemetry && held.boundary === 'telemetry') ||
                (peaks && sampleArgument === 1 && held.boundary === 'peaks'))
        ) {
            held.consumed = true;
            held.entered.resolve();
            return held.response.promise;
        }
        if (telemetry || command === 'get_crumbs_position') {
            return 0;
        }
        if (peaks) {
            if (sampleArgument === 1) {
                return FIRST_PEAKS;
            }
            return SECOND_PEAKS;
        }
        return undefined;
    });
    vi.stubGlobal(
        'ResizeObserver',
        class implements ResizeObserver {
            constructor(private readonly callback: ResizeObserverCallback) {}
            observe(): void {
                this.callback([], this);
            }
            unobserve(): void {}
            disconnect(): void {}
        }
    );
    vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 240, 64));
    const context = document.createElement('canvas').getContext('2d');
    if (!context) {
        throw new Error('Expected the test drawing context');
    }
    paint = vi.spyOn(context, 'fillRect');
    configureAutomergeStoragePort(null);
    resetCrdtProjectAuthority('Crumbs app waveform authority');
    removeCrdtDoc('root');
    createCrdtDoc('root');
    registerCrdtStorageRuntime();
    clearHandlerRegistry();
    registerHandlerMap(getArrangementHandlers());
    projectStore.set({ ...defaultProjectStoreState, loading: false, createdAt: 100, updatedAt: 100 });
    disposeReconciliation = initDeviceStateReconciliation();
    disposeProjection = setupProjectionBridge();
    disposePersistence = initCrumbsDeviceStatePersistence();
    disposeNative = syncCrumbsNativeInstances();
    const track = createTrack({ id: TRACK, name: 'Sampler', kind: 'midi', withoutDefaultDevice: true });
    const unrelated = createTrack({ id: 'ordinary-track', name: 'Ordinary', kind: 'midi', withoutDefaultDevice: true });
    trackStore.set({ tracks: [{ ...track, devices: [device()] }, unrelated], selectedTrackId: TRACK, ghostClips: [] });
    flushAutomergeStorageWrites();
    const view = render(<CrumbsPanel deviceId={deviceId} />);
    const faceplate = view.container.querySelector<HTMLElement>('.crumbs-faceplate');
    if (!faceplate) {
        throw new Error('The actual Crumbs panel must mount');
    }
    panel = faceplate;
    await waitFor(() => expect(screen.getByText('Ready', { exact: true })).toBeInTheDocument());
});

afterEach(async () => {
    cleanup();
    disposeReconciliation();
    disposeProjection();
    disposePersistence();
    trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
    flushAutomergeStorageWrites();
    const created = native.invoke.mock.calls.filter(([command]) => command === 'create_crumbs');
    for (const [, input] of created) {
        if (typeof input?.[0] !== 'string') {
            throw new TypeError('Expected the created native instance identity');
        }
        const createdId = input[0];
        await waitFor(() =>
            expect(
                native.invoke.mock.calls.some(
                    ([command, value]) => command === 'destroy_crumbs' && value?.[0] === createdId
                )
            ).toBe(true)
        );
    }
    disposeNative();
    removeCrdtDoc('root');
    removeCrdtDoc('unrelated-waveform-document');
    configureAutomergeStoragePort(null);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    if (desktopBridgeDescriptor) {
        Object.defineProperty(window, 'sourdaw', desktopBridgeDescriptor);
    } else {
        Reflect.deleteProperty(window, 'sourdaw');
    }
});

describe('Crumbs waveform authority from the actual application producer', () => {
    it('retains a pending owner when another actual Crumbs device loads independently', async () => {
        const request = await beginHeldDrop('peaks');
        const otherId = `${deviceId}-independent`;
        await act(async () => {
            mutateCrdtDoc<Root>({
                id: 'root',
                changeFn: (document) => {
                    const other = document.tracks.tracks.find((track) => track.id === 'ordinary-track');
                    if (!other) {
                        throw new Error('Expected the independent track');
                    }
                    other.devices.push({ ...device(), id: otherId });
                },
            });
        });
        const view = render(<CrumbsPanel deviceId={otherId} />);
        const otherPanel = view.container.querySelector<HTMLElement>('.crumbs-faceplate');
        if (!otherPanel) {
            throw new Error('Expected the independent Crumbs panel');
        }
        await waitFor(() => expect(within(otherPanel).getByText('Ready', { exact: true })).toBeInTheDocument());
        await act(async () => {
            drop('/b.wav', otherPanel);
            await awaitModeCompletions(1);
        });
        expect(within(otherPanel).getByText('b.wav', { exact: true })).toBeInTheDocument();
        paint.mockClear();
        await act(async () => {
            request.response.resolve(FIRST_PEAKS);
            await awaitModeCompletions(2);
        });
        expect(within(panel).getByText('a.wav', { exact: true })).toBeInTheDocument();
        expect(paint.mock.calls.slice(-2)[0]?.[1]).toBeCloseTo(6.4);
        expect(native.invoke).toHaveBeenCalledWith('get_waveform_peaks', [deviceId, 1, 0, 0]);
        expect(native.invoke).toHaveBeenCalledWith('get_waveform_peaks', [otherId, 2, 0, 0]);
    });

    it('keeps its own metadata mirror, ordinary parameter action and unrelated document edits admitted', async () => {
        const access = createCrumbsSampleProjectAccess();
        const authority = access.capture(deviceId);
        expect(authority).not.toBeNull();
        const objectId = getObjectId(rawDevice());
        const request = await beginHeldDrop('peaks');
        expect(getObjectId(rawDevice())).toBe(objectId);
        expect(access.capture(deviceId)).toBe(authority);

        await act(async () => {
            await executeAppAction({
                type: 'setDeviceParameter',
                payload: { expectedTrackId: TRACK, deviceId, paramId: 'tune', value: 5 },
            });
            await executeAppAction({ type: 'renameTrack', payload: { trackId: 'ordinary-track', name: 'Renamed' } });
            flushAutomergeStorageWrites();
            createCrdtDoc('unrelated-waveform-document');
            mutateCrdtDoc({
                id: 'unrelated-waveform-document',
                changeFn: (document) => {
                    document.note = 'ordinary';
                },
            });
        });
        expect(rawDevice().parameterValues.tune).toBe(5);
        expect(root().tracks.tracks.find((track) => track.id === 'ordinary-track')?.name).toBe('Renamed');
        expect(getObjectId(rawDevice())).toBe(objectId);
        expect(access.capture(deviceId)).toBe(authority);
        await act(async () => {
            request.response.resolve(FIRST_PEAKS);
            await awaitModeCompletions(1);
        });
        expect(screen.getByText('a.wav', { exact: true })).toBeInTheDocument();
        expect(paint.mock.calls.slice(-2)[0]?.[1]).toBeCloseTo(6.4);
        expect(rawDevice().deviceState).toMatchObject({ data: { activeSample: { filePath: '/a.wav', sampleId: 1 } } });
    });

    it.each(['telemetry', 'peaks'] as const)('keeps rendered B paired after A settles from %s', async (boundary) => {
        const request = await beginHeldDrop(boundary);
        await finishCurrentDrop('/b.wav', 1);
        expectSecondWaveform();
        paint.mockClear();
        await act(async () => {
            if (boundary === 'telemetry') {
                request.response.resolve(0);
            } else {
                request.response.resolve(FIRST_PEAKS);
            }
            await awaitModeCompletions(2);
        });
        expect(screen.getByText('b.wav', { exact: true })).toBeInTheDocument();
        expect(rawDevice().deviceState).toMatchObject({ data: { activeSample: { filePath: '/b.wav' } } });
        expect(paint).not.toHaveBeenCalled();
    });

    it.each([
        ['telemetry', 'root'],
        ['peaks', 'root'],
        ['telemetry', 'root-recreate'],
        ['peaks', 'root-recreate'],
        ['telemetry', 'device'],
        ['peaks', 'device'],
        ['telemetry', 'device-ABA'],
        ['peaks', 'device-ABA'],
        ['telemetry', 'type-ABA'],
        ['peaks', 'type-ABA'],
        ['telemetry', 'duplicate'],
        ['peaks', 'duplicate'],
        ['telemetry', 'owner-ABA'],
        ['peaks', 'owner-ABA'],
        ['telemetry', 'owner-id-ABA'],
        ['peaks', 'owner-id-ABA'],
    ] as const)('refuses outgoing %s publication after actual %s replacement', async (boundary, replacement) => {
        const request = await beginHeldDrop(boundary);
        const saved = clone(root());
        const installation = captureProjectRootIdentity();
        // Keep the view on its preceding projection while committed truth changes.
        // This is the window before native cleanup; no newer load/leaf may mask the lifetime guard.
        disposeProjection();
        await act(async () => {
            if (replacement === 'root') {
                replaceCrdtDoc({ id: 'root', doc: clone(saved) });
                expect(captureProjectRootIdentity()).not.toBe(installation);
            } else if (replacement === 'root-recreate') {
                removeCrdtDoc('root');
                replaceCrdtDoc({ id: 'root', doc: clone(saved) });
                expect(captureProjectRootIdentity()).not.toBe(installation);
            } else if (replacement === 'device') {
                editDevices((devices) => {
                    devices.splice(0, 1, device());
                });
            } else if (replacement === 'duplicate') {
                editDevices((devices) => {
                    devices.push(device());
                });
                editDevices((devices) => {
                    devices.pop();
                });
            } else if (replacement === 'type-ABA') {
                editDevices((devices) => {
                    const target = devices[0];
                    if (!target) {
                        throw new Error('Missing device');
                    }
                    target.type = 'builtin-yeast';
                });
                replaceCrdtDocInLineage({ id: 'root', doc: clone(saved) });
                expect(captureProjectRootIdentity()).toBe(installation);
            } else if (replacement === 'owner-id-ABA') {
                for (const ownerId of ['replacement-owner-id', TRACK]) {
                    mutateCrdtDoc<Root>({
                        id: 'root',
                        changeFn: (document) => {
                            const owner = document.tracks.tracks[0];
                            if (!owner) {
                                throw new Error('Expected the existing owner');
                            }
                            owner.id = ownerId;
                        },
                    });
                }
                expect(captureProjectRootIdentity()).toBe(installation);
                expect(getObjectId(root().tracks.tracks[0])).toBe(getObjectId(saved.tracks.tracks[0]));
                expect(getObjectId(rawDevice())).toBe(getObjectId(saved.tracks.tracks[0]?.devices[0]));
            } else if (replacement === 'owner-ABA') {
                mutateCrdtDoc<Root>({
                    id: 'root',
                    changeFn: (document) => {
                        const first = document.tracks.tracks[0];
                        if (!first) {
                            throw new Error('Expected the first owner');
                        }
                        first.devices = [];
                        document.tracks.tracks.push({
                            ...createTrack({
                                id: 'other-owner',
                                name: 'Other',
                                kind: 'midi',
                                withoutDefaultDevice: true,
                            }),
                            devices: [device()],
                        });
                    },
                });
                replaceCrdtDocInLineage({ id: 'root', doc: clone(saved) });
                expect(captureProjectRootIdentity()).toBe(installation);
            } else {
                editDevices((devices) => {
                    devices.splice(0, 1);
                });
                replaceCrdtDocInLineage({ id: 'root', doc: clone(saved) });
                expect(captureProjectRootIdentity()).toBe(installation);
                expect(getObjectId(rawDevice())).toBe(getObjectId(saved.tracks.tracks[0]?.devices[0]));
            }
        });
        disposeProjection = setupProjectionBridge();
        paint.mockClear();
        await act(async () => {
            if (boundary === 'telemetry') {
                request.response.resolve(0);
            } else {
                request.response.resolve(FIRST_PEAKS);
            }
            // This command is emitted after handleFileDrop awaited the old loader's settlement.
            await awaitModeCompletions(1);
        });
        expect(screen.getByText('a.wav', { exact: true })).toBeInTheDocument();
        expect(paint).not.toHaveBeenCalled();
        if (boundary === 'telemetry') {
            expect(
                native.invoke.mock.calls.filter(
                    ([command, input]) => command === 'get_waveform_peaks' && input?.[1] === 1
                )
            ).toEqual([]);
        }
        await act(async () => {
            projectCrdtToStores();
        });
        await finishCurrentDrop('/b.wav', 2);
        expectSecondWaveform();
    });
});
