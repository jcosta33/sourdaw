import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getProductionCommandHandlerMaps } from '#/app/getProductionCommandHandlerMaps';
import {
    configureAutomergeStoragePort,
    runWithAutomergeStorageTransaction,
} from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { installTransactionalIndexedDb } from '#/infra/testing/installTransactionalIndexedDb';
import { type Device, type Track, trackStore } from '#/modules/Arrangement/stores';
import { createTrack, getPluginById } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import * as automationUseCases from '#/modules/Automation/useCases';
import { setAutomationRecordingDependencies, stopAutomationRecording } from '#/modules/Automation/useCases';
import { clearHandlerRegistry, macroStore, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeUserAppAction,
    reconcileSessionUndoForProject,
    redo,
    registerProductionCommandHandlers,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    stampSessionUndoWitness,
    undo,
} from '#/modules/Command/useCases';
import { agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureDurableDocumentWitness,
    clearActionHistory,
    compactProject,
    createCrdtDoc,
    getCrdtDoc,
    hasCrdtDoc,
    loadCrdtProject,
    markActionHistoryEntryReverted,
    persistCrdtProject,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
    sessionUndoWitnessStampPort,
    settlePendingProjectWritesAndCaptureRevision,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { defaultTransportState, setGestureClockSource, transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { resolveDeviceLayout } from '../../deviceLayoutRegistry';
import '../BuiltinSynthLayout';

function requireRegisteredLayout(type: string, missingMessage: string) {
    const layout = resolveDeviceLayout(type);
    if (!layout) {
        throw new Error(missingMessage);
    }
    return layout;
}
const RegisteredSynthLayout = requireRegisteredLayout('builtin-synth', 'Missing registered Synth layout');
const RegisteredMellotronLayout = requireRegisteredLayout(
    'builtin-synth-mellotron',
    'Missing registered Mellotron layout'
);
const RegisteredStringsLayout = requireRegisteredLayout(
    'builtin-synth-strings',
    'Missing registered Analog Strings layout'
);
const Registered808BassLayout = requireRegisteredLayout('builtin-synth-808bass', 'Missing registered 808 Bass layout');
const RegisteredBrassLayout = requireRegisteredLayout('builtin-synth-brass', 'Missing registered Classic Brass layout');

// The registered layout, canvas, controls, commands and CRDT/history are real.
// Only the engine I/O boundary is controlled so every physical sample is visible.
const engineWrites: { trackId: string; deviceId: string; paramId: string; value: number }[] = [];
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    updateDeviceParam: (trackId: string, deviceId: string, paramId: string, value: number) => {
        engineWrites.push({ trackId, deviceId, paramId, value });
    },
    mirrorDeviceChainDelta: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    projectsToDifferentNativeBank: vi.fn(() => false),
    nativeLiveGraphSessionSplice: vi.fn(() => Promise.resolve({ outcome: 'skipped', reason: 'no session' })),
    isDeviceCarriedByNativeSession: () => false,
    writeNativeBuiltinParameters: vi.fn(),
}));

const PROJECT_ID = 'synth-envelope-project';
const SESSION_KEY = 'sourdaw-undo-session';
const DEVICE_ID = 'synth-1';
const INITIAL_ENVELOPE = { attack: 0.5, decay: 0.5, sustain: 0.5, release: 0.5 };
const stages = ['attack', 'decay', 'sustain', 'release'] as const;
type Stage = (typeof stages)[number];
const deviceTypes = [
    'builtin-synth',
    'builtin-synth-mellotron',
    'builtin-synth-strings',
    'builtin-synth-808bass',
    'builtin-synth-brass',
] as const;
type SynthType = (typeof deviceTypes)[number];
type Envelope = Record<Stage, number>;

function makeDevice(type: SynthType, absent?: Stage): Device {
    const parameterValues: Record<string, number> = structuredClone(INITIAL_ENVELOPE);
    if (absent) {
        delete parameterValues[absent];
    }
    return { id: DEVICE_ID, name: type, type, bypassed: false, parameterValues };
}
function targetTrack(device: Device): Track {
    return {
        ...createTrack({ id: 'track-1', name: 'Synth', kind: 'midi', withoutDefaultDevice: true }),
        devices: [device],
    };
}
function seed(type: SynthType = 'builtin-synth', absent?: Stage): void {
    trackStore.set({
        tracks: [
            targetTrack(makeDevice(type, absent)),
            { ...targetTrack({ ...makeDevice('builtin-synth'), id: 'settlement-device' }), id: 'settlement-track' },
        ],
        selectedTrackId: 'track-1',
        ghostClips: [],
    });
    settlePendingProjectWritesAndCaptureRevision();
}

function values(): Record<string, number> {
    const device = trackStore.value?.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Missing real projected Synth');
    }
    return device.parameterValues;
}
function rawTracks(): Track[] {
    const tracks = getCrdtDoc<{ tracks: { tracks: Track[] } }>('root')?.tracks.tracks;
    if (!tracks) {
        throw new Error('Missing real CRDT tracks');
    }
    return tracks;
}
function rawValues(): Record<string, number> {
    const device = rawTracks()[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Missing raw CRDT Synth');
    }
    return device.parameterValues;
}
function depth(): number {
    return undoStore.value?.past.length ?? 0;
}
function writes(): typeof engineWrites {
    return engineWrites.filter((write) => write.deviceId === DEVICE_ID);
}
function Layout({ displayed }: { displayed?: Device }) {
    const state = useStore(trackStore, { tracks: [], selectedTrackId: null });
    const device = displayed ?? state.tracks[0]?.devices.find((candidate) => candidate.id === DEVICE_ID);
    if (!device) {
        throw new Error('Required Synth layout was not mounted');
    }
    const descriptor = getPluginById(device.type);
    if (!descriptor) {
        throw new Error(`Missing actual descriptor for ${device.type}`);
    }
    switch (device.type) {
        case 'builtin-synth':
            return <RegisteredSynthLayout device={device} parameters={descriptor.parameters} trackId="track-1" />;
        case 'builtin-synth-mellotron':
            return <RegisteredMellotronLayout device={device} parameters={descriptor.parameters} trackId="track-1" />;
        case 'builtin-synth-strings':
            return <RegisteredStringsLayout device={device} parameters={descriptor.parameters} trackId="track-1" />;
        case 'builtin-synth-808bass':
            return <Registered808BassLayout device={device} parameters={descriptor.parameters} trackId="track-1" />;
        case 'builtin-synth-brass':
            return <RegisteredBrassLayout device={device} parameters={descriptor.parameters} trackId="track-1" />;
        default:
            throw new Error(`Unsupported Synth layout type ${device.type}`);
    }
}
function curve(): HTMLCanvasElement {
    const canvas = screen.getByRole('img', { name: 'ADSR envelope shape' });
    if (!(canvas instanceof HTMLCanvasElement)) {
        throw new Error('Required actual Synth envelope canvas is absent');
    }
    return canvas;
}
function expectStageValue(type: SynthType, stage: Stage, value: number): void {
    const parameter = getPluginById(type)?.parameters.find((candidate) => candidate.id === stage);
    if (!parameter) {
        throw new Error(`Missing actual ${type}/${stage} descriptor`);
    }
    const thumb = screen.getByRole('slider', { name: parameter.name });
    let position = value;
    if (parameter.scaling === 'log') {
        position = Math.log(value / parameter.minValue) / Math.log(parameter.maxValue / parameter.minValue);
    }
    expect(thumb).toHaveAttribute('aria-valuenow');
    expect(Number(thumb.getAttribute('aria-valuenow'))).toBeCloseTo(position, 10);
    const readout = screen.getByText(parameter.name, { selector: 'label' }).parentElement;
    if (!readout) {
        throw new Error(`Missing real ${stage} readout`);
    }
    expect(
        within(readout).getByText(
            `${value.toFixed(stage === 'sustain' ? 3 : 2)}${parameter.unit ? ` ${parameter.unit}` : ''}`
        )
    ).toBeVisible();
}
function expectAttackValue(value: number): void {
    expectStageValue('builtin-synth', 'attack', value);
}
function nativeEnvelope(type: SynthType, parameterValues = values()): Envelope {
    const read = (stage: Stage): number => {
        const parameter = getPluginById(type)?.parameters.find((candidate) => candidate.id === stage);
        if (!parameter) {
            throw new Error(`Missing ${type}/${stage}`);
        }
        return parameterValues[stage] ?? parameter.defaultValue ?? parameter.value;
    };
    return { attack: read('attack'), decay: read('decay'), sustain: read('sustain'), release: read('release') };
}
function breakpoint(stage: Stage, envelope: Envelope): { x: number; y: number } {
    const total = envelope.attack + envelope.decay + 0.4 + envelope.release;
    if (stage === 'attack') {
        return { x: 6 + (envelope.attack / total) * 188, y: 8 };
    }
    if (stage === 'decay') {
        return { x: 6 + ((envelope.attack + envelope.decay) / total) * 188, y: 74 - envelope.sustain * 64 };
    }
    if (stage === 'sustain') {
        return { x: 6 + ((envelope.attack + envelope.decay + 0.4) / total) * 188, y: 74 - envelope.sustain * 64 };
    }
    return { x: 194, y: 74 };
}
let drag: { stage: Stage; view: Envelope; startView: Envelope; startClientX: number; canvas: HTMLCanvasElement };
function begin(
    stage: Stage = 'attack',
    type: SynthType = 'builtin-synth',
    parameterValues = values()
): HTMLCanvasElement {
    const canvas = curve();
    const view = nativeEnvelope(type, parameterValues);
    const point = breakpoint(stage, view);
    vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
        x: 0,
        y: 0,
        left: 0,
        top: 0,
        right: 200,
        bottom: 80,
        width: 200,
        height: 80,
        toJSON: () => ({}),
    });
    drag = { stage, view, startView: structuredClone(view), startClientX: point.x, canvas };
    fireEvent.pointerDown(canvas, { button: 0, pointerId: 5, clientX: point.x, clientY: point.y });
    return canvas;
}
function move(value: number, canvas = drag.canvas): void {
    const { stage, view } = drag;
    const total = view.attack + view.decay + 0.4 + view.release;
    let clientX: number;
    if (stage === 'sustain') {
        clientX = breakpoint(stage, view).x;
    } else if (stage === 'release') {
        clientX =
            drag.startClientX +
            ((value - drag.startView.release) * 188) /
                (drag.startView.attack + drag.startView.decay + 0.4 + drag.startView.release);
    } else {
        let time = value;
        if (stage === 'decay') {
            time += view.attack;
        }
        clientX = 6 + (time / total) * 188;
    }
    fireEvent.pointerMove(canvas, {
        pointerId: 5,
        clientX,
        clientY: stage === 'sustain' ? 8 + (1 - value) * 66 : breakpoint(stage, view).y,
    });
    view[stage] = value;
}
function end(canvas = drag.canvas): void {
    fireEvent.pointerUp(canvas, { pointerId: 5 });
}
async function committed(type: SynthType, stage: Stage, value: number, historyDepth = 1): Promise<void> {
    await waitFor(() => {
        expect(rawValues()[stage]).toBeCloseTo(value, 12);
        expect(values()[stage]).toBeCloseTo(value, 12);
        expect(depth()).toBe(historyDepth);
        expectStageValue(type, stage, value);
    });
    expect(writes().at(-1)).toMatchObject({
        trackId: 'track-1',
        deviceId: DEVICE_ID,
        paramId: stage,
        value: expect.closeTo(value, 12),
    });
}
async function drainActions(): Promise<void> {
    await act(() =>
        executeUserAppAction({
            type: 'setDeviceParameter',
            payload: {
                deviceId: 'settlement-device',
                paramId: 'attack',
                value: 0.5,
                automationRecordingPolicy: 'suppressed',
            },
        })
    );
}
async function activateProject(): Promise<void> {
    const transition = runProjectLoadTransaction();
    expect(await transition.prepare()).toBe(true);
    expect(transition.activate()).toBe(true);
}
function recordMode(mode: 'read' | 'write' | 'touch' | 'latch'): void {
    trackStore.set({
        ...trackStore.value!,
        tracks: trackStore.value!.tracks.map((track) =>
            track.id === 'track-1' ? { ...track, automationMode: mode } : track
        ),
    });
    transportStore.set({ ...defaultTransportState, isPlaying: true, tempo: 120 });
    automationStore.set({
        lanes: [
            {
                id: 'sustain-ride',
                trackId: 'track-1',
                parameterId: `${DEVICE_ID}:sustain`,
                parameterName: 'Sustain',
                points: [],
                objects: [],
                visible: true,
                enabled: true,
                collapsed: false,
                minValue: 0,
                maxValue: 1,
            },
        ],
    });
    settlePendingProjectWritesAndCaptureRevision();
}

describe('actual registered Synth envelope through real project and history', () => {
    let indexedDb: ReturnType<typeof installTransactionalIndexedDb>;
    beforeAll(() => {
        indexedDb = installTransactionalIndexedDb();
    });
    afterAll(async () => {
        await indexedDb.dispose();
    });
    beforeEach(async () => {
        vi.clearAllMocks();
        engineWrites.length = 0;
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Synth envelope gesture');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        await compactProject();
        clearHandlerRegistry();
        clearUndoHistory();
        sessionStorage.removeItem(SESSION_KEY);
        registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
        resetActionReplayAuthority();
        clearActionHistory();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        sessionUndoWitnessStampPort.setProvider(stampSessionUndoWitness);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        await activateProject();
        seed();
        automationStore.set({ lanes: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        const context = new AudioContext();
        setAutomationRecordingDependencies({ getAudioContext: () => context, getCompensationDelay: () => 0 });
        reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
        settlePendingProjectWritesAndCaptureRevision();
    });
    afterEach(() => {
        cleanup();
        stopAutomationRecording();
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        clearActionHistory();
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        sessionUndoWitnessStampPort.setProvider(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        automationStore.set({ lanes: [] });
        agentProjectRepairStateStore.set(null);
        transportStore.set({ ...defaultTransportState, isPlaying: false });
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => null });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        sessionStorage.removeItem(SESSION_KEY);
        vi.restoreAllMocks();
    });

    it('previews every actual attack move without truth writes, then commits one undoable edit', async () => {
        render(<Layout />);
        const canvas = curve();
        vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({
            x: 0,
            y: 0,
            left: 0,
            top: 0,
            right: 200,
            bottom: 80,
            width: 200,
            height: 80,
            toJSON: () => ({}),
        });
        const before = structuredClone(rawValues());
        const revision = settlePendingProjectWritesAndCaptureRevision();
        const totalTime = INITIAL_ENVELOPE.attack + INITIAL_ENVELOPE.decay + 0.4 + INITIAL_ENVELOPE.release;
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 5, clientX: 6 + (0.5 / totalTime) * 188, clientY: 8 });
        let previousAttack = INITIAL_ENVELOPE.attack;
        const observations = [0.15, 0.35, 0.45].map((sample) => {
            const currentTime = previousAttack + INITIAL_ENVELOPE.decay + 0.4 + INITIAL_ENVELOPE.release;
            fireEvent.pointerMove(canvas, { pointerId: 5, clientX: 6 + (sample / currentTime) * 188, clientY: 8 });
            previousAttack = sample;
            const sampleRevision = settlePendingProjectWritesAndCaptureRevision();
            return {
                raw: structuredClone(rawValues()),
                projected: structuredClone(values()),
                revision: sampleRevision,
                historyDepth: depth(),
            };
        });
        expect(writes()).toHaveLength(3);
        for (const [index, sample] of [0.15, 0.35, 0.45].entries()) {
            expect(writes()[index]).toMatchObject({ trackId: 'track-1', deviceId: DEVICE_ID, paramId: 'attack' });
            expect(writes()[index]?.value).toBeCloseTo(sample, 12);
            expect(observations[index]?.raw).toEqual(before);
            expect(observations[index]?.projected).toEqual(before);
            expect(observations[index]?.revision).toBe(revision);
            expect(observations[index]?.historyDepth).toBe(0);
        }
        expectAttackValue(0.45);
        fireEvent.pointerUp(canvas, { pointerId: 5 });
        await waitFor(() => {
            expect(rawValues().attack).toBeCloseTo(0.45, 12);
            expect(values().attack).toBeCloseTo(0.45, 12);
            expect(depth()).toBe(1);
        });
        await act(() => undo());
        expect(rawValues()).toEqual(before);
        expect(values()).toEqual(before);
        expectAttackValue(INITIAL_ENVELOPE.attack);
        expect(writes().at(-1)?.value).toBe(INITIAL_ENVELOPE.attack);
        await act(() => redo());
        expect(rawValues().attack).toBeCloseTo(0.45, 12);
        expect(values().attack).toBeCloseTo(0.45, 12);
        expectAttackValue(0.45);
        expect(writes().at(-1)?.value).toBeCloseTo(0.45, 12);
    });

    it.each(deviceTypes.flatMap((type) => stages.map((stage) => ({ type, stage }))))(
        'previews every $type $stage sample in its native law and commits exactly one entry',
        async ({ type, stage }) => {
            seed(type);
            render(<Layout />);
            const canvas = begin(stage, type);
            const context = canvas.getContext('2d');
            if (!context) {
                throw new Error('Required actual envelope drawing context is absent');
            }
            const marker = vi.spyOn(context, 'arc');
            const before = structuredClone(rawValues());
            const revision = settlePendingProjectWritesAndCaptureRevision();
            const samples = stage === 'release' ? [0.25, 0.15, 0.05] : [0.15, 0.35, 0.45];
            const finalValue = stage === 'release' ? 0.05 : 0.45;
            for (const [index, sample] of samples.entries()) {
                marker.mockClear();
                move(sample);
                expect(writes()).toHaveLength(index + 1);
                expect(writes()[index]).toMatchObject({ paramId: stage, value: expect.closeTo(sample, 12) });
                expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
                expect(rawValues()).toEqual(before);
                expect(values()).toEqual(before);
                expect(depth()).toBe(0);
                expectStageValue(type, stage, sample);
                const point = breakpoint(stage, drag.view);
                expect(marker).toHaveBeenCalledWith(
                    expect.closeTo(point.x, 10),
                    expect.closeTo(point.y, 10),
                    6,
                    0,
                    Math.PI * 2
                );
            }
            end();
            fireEvent.lostPointerCapture(canvas, { pointerId: 5 });
            end();
            await committed(type, stage, finalValue);
            expect(writes()).toHaveLength(4);
            expect(writes().every((entry) => entry.paramId === stage)).toBe(true);
            expect(rawValues()).toEqual({ ...before, [stage]: expect.closeTo(finalValue, 12) });
            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expectStageValue(type, stage, 0.5);
            expect(writes().at(-1)).toMatchObject({ paramId: stage, value: 0.5 });
            await act(() => redo());
            expect(rawValues()[stage]).toBeCloseTo(finalValue, 12);
            expectStageValue(type, stage, finalValue);
            expect(writes().at(-1)?.value).toBeCloseTo(finalValue, 12);
        }
    );

    it.each(deviceTypes)(
        'previews increasing release samples for %s without truth writes, then commits one undoable edit',
        async (type) => {
            seed(type);
            render(<Layout />);
            begin('release', type);
            const before = structuredClone(rawValues());
            const revision = settlePendingProjectWritesAndCaptureRevision();
            const samples = [0.65, 0.85, 0.75];

            for (const [index, sample] of samples.entries()) {
                move(sample);
                expect(writes()).toHaveLength(index + 1);
                expect(writes()[index]).toMatchObject({ paramId: 'release', value: expect.closeTo(sample, 12) });
                expect(settlePendingProjectWritesAndCaptureRevision()).toBe(revision);
                expect(rawValues()).toEqual(before);
                expect(values()).toEqual(before);
                expect(depth()).toBe(0);
                expectStageValue(type, 'release', sample);
            }

            end();
            await committed(type, 'release', 0.75);
            expect(writes()).toHaveLength(4);
            expect(rawValues()).toEqual({ ...before, release: expect.closeTo(0.75, 12) });

            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expectStageValue(type, 'release', 0.5);
            expect(writes().at(-1)).toMatchObject({ paramId: 'release', value: 0.5 });

            await act(() => redo());
            expect(rawValues().release).toBeCloseTo(0.75, 12);
            expect(values().release).toBeCloseTo(0.75, 12);
            expectStageValue(type, 'release', 0.75);
            expect(writes().at(-1)).toMatchObject({ paramId: 'release', value: expect.closeTo(0.75, 12) });
        }
    );

    it.each(deviceTypes.flatMap((type) => stages.map((stage) => ({ type, stage }))))(
        'restores an absent $type $stage field and its real descriptor default',
        async ({ type, stage }) => {
            seed(type, stage);
            const before = structuredClone(rawValues());
            const defaultValue = nativeEnvelope(type)[stage];
            const finalValue = stage === 'release' ? 0.05 : 0.45;
            render(<Layout />);
            expectStageValue(type, stage, defaultValue);
            begin(stage, type);
            move(finalValue);
            end();
            await committed(type, stage, finalValue);
            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expect(Object.hasOwn(rawValues(), stage)).toBe(false);
            expect(writes().at(-1)).toMatchObject({ paramId: stage, value: defaultValue });
            expectStageValue(type, stage, defaultValue);
            await act(() => redo());
            expect(rawValues()[stage]).toBeCloseTo(finalValue, 12);
        }
    );

    it('keeps two drags and a different stage knob in separate undo entries', async () => {
        render(<Layout />);
        begin();
        move(0.15);
        end();
        await committed('builtin-synth', 'attack', 0.15, 1);
        begin();
        move(0.45);
        end();
        await committed('builtin-synth', 'attack', 0.45, 2);
        fireEvent.keyDown(screen.getByRole('slider', { name: 'Decay' }), { key: 'End' });
        await waitFor(() => expect(depth()).toBe(3));
        expect(rawValues().decay).toBe(2);
        await act(() => undo());
        expect(rawValues().decay).toBe(0.5);
        expect(rawValues().attack).toBeCloseTo(0.45, 12);
        await act(() => undo());
        expect(rawValues().attack).toBeCloseTo(0.15, 12);
        await act(() => undo());
        expect(rawValues()).toEqual(INITIAL_ENVELOPE);
    });

    it('keeps equal stage names on two device identities in distinct entries', async () => {
        const second = { ...makeDevice('builtin-synth'), id: 'second-synth' };
        const state = trackStore.value!;
        trackStore.set({
            ...state,
            tracks: state.tracks.map((track) =>
                track.id === 'track-1' ? { ...track, devices: [...track.devices, second] } : track
            ),
        });
        settlePendingProjectWritesAndCaptureRevision();
        const firstView = render(<Layout />);
        begin();
        move(0.45);
        end();
        await committed('builtin-synth', 'attack', 0.45);
        firstView.unmount();
        render(<Layout displayed={second} />);
        begin('attack', 'builtin-synth', second.parameterValues);
        move(0.15);
        end();
        const secondValues = () => rawTracks()[0]?.devices.find((device) => device.id === second.id)?.parameterValues;
        await waitFor(() => {
            expect(depth()).toBe(2);
            expect(secondValues()?.attack).toBeCloseTo(0.15, 12);
        });
        await act(() => undo());
        expect(secondValues()?.attack).toBe(0.5);
        expect(rawValues().attack).toBeCloseTo(0.45, 12);
        await act(() => undo());
        expect(rawValues()).toEqual(INITIAL_ENVELOPE);
        expect(secondValues()).toEqual(INITIAL_ENVELOPE);
    });

    it.each([false, true])('keeps a click or return to the start/default out of history, absent=%s', async (absent) => {
        const type = 'builtin-synth-808bass';
        seed(type, absent ? 'sustain' : undefined);
        const before = structuredClone(rawValues());
        const start = nativeEnvelope(type).sustain;
        render(<Layout />);
        const canvas = curve();
        end(canvas);
        fireEvent.pointerDown(canvas, { button: 0, pointerId: 5, clientX: 0, clientY: 0 });
        fireEvent.pointerMove(canvas, { pointerId: 5, clientX: 100, clientY: 40 });
        end(canvas);
        begin('sustain', type);
        end();
        expect(writes()).toEqual([]);
        begin('sustain', type);
        move(0.45);
        move(start);
        end();
        await drainActions();
        expect(rawValues()).toEqual(before);
        expect(values()).toEqual(before);
        expect(depth()).toBe(0);
        expect(writes().map((entry) => entry.value)).toEqual([expect.closeTo(0.45, 12), start]);
    });

    it.each(['pointerCancel', 'lostPointerCapture', 'windowBlur', 'hidden', 'unmount', 'nonfinite'])(
        'restores runtime only after %s without persisting an unfinished stage',
        async (finish) => {
            const view = render(<Layout />);
            const canvas = begin();
            move(0.45);
            if (finish === 'pointerCancel') {
                fireEvent.pointerCancel(canvas, { pointerId: 5 });
            } else if (finish === 'lostPointerCapture') {
                fireEvent.lostPointerCapture(canvas, { pointerId: 5 });
            } else if (finish === 'windowBlur') {
                fireEvent.blur(window);
            } else if (finish === 'hidden') {
                vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
                fireEvent(document, new Event('visibilitychange'));
            } else if (finish === 'unmount') {
                view.unmount();
            } else {
                const malformed = new Event('pointermove', { bubbles: true });
                Object.defineProperties(malformed, {
                    pointerId: { value: 5 },
                    clientX: { value: Number.NaN },
                    clientY: { value: 8 },
                });
                fireEvent(canvas, malformed);
            }
            end(canvas);
            await drainActions();
            expect(rawValues()).toEqual(INITIAL_ENVELOPE);
            expect(values()).toEqual(INITIAL_ENVELOPE);
            expect(depth()).toBe(0);
            expect(writes().map((entry) => entry.value)).toEqual([expect.closeTo(0.45, 12), 0.5]);
            if (finish !== 'unmount') {
                expectAttackValue(0.5);
            }
        }
    );

    it('restores authoritative engine and display when project admission refuses the final', async () => {
        render(<Layout />);
        begin();
        move(0.45);
        act(() =>
            agentProjectRepairStateStore.set({
                audioGraphValid: false,
                detectedRevision: 'repair-revision',
                inspectionAvailable: true,
                projectInvariantsValid: false,
                rawProjectRetained: true,
                repairCandidates: [],
                status: 'repair-required',
            })
        );
        end();
        await waitFor(() => expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning'));
        await waitFor(() => expectAttackValue(0.5));
        expect(rawValues()).toEqual(INITIAL_ENVELOPE);
        expect(depth()).toBe(0);
        expect(writes().map((entry) => entry.value)).toEqual([expect.closeTo(0.45, 12), 0.5]);
    });

    it.each([
        'value',
        'frozen',
        'chain',
        'duplicate-device-owner',
        'duplicate-track-owner',
        'device-removed',
        'same-id-type-successor',
        'project-epoch',
    ])('refuses the real queued final after %s changes without overwriting its successor', async (change) => {
        render(<Layout displayed={makeDevice('builtin-synth')} />);
        const canvas = begin();
        move(0.45);
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const snapshot = transactSnapshot(async (transaction) => {
            entered.resolve();
            await release.promise;
            if (change === 'project-epoch') {
                return;
            }
            const write = runWithAutomergeStorageTransaction(transaction, () => {
                const state = trackStore.value!;
                const track = state.tracks[0]!;
                const device = track.devices[0]!;
                let replacement = track;
                if (change === 'value') {
                    replacement = {
                        ...track,
                        devices: [{ ...device, parameterValues: { ...device.parameterValues, attack: 0.8 } }],
                    };
                } else if (change === 'frozen') {
                    replacement = { ...track, frozen: true };
                } else if (change === 'chain') {
                    replacement = {
                        ...track,
                        devices: [device, { ...makeDevice('builtin-synth'), id: 'extra-device' }],
                    };
                } else if (change === 'device-removed') {
                    replacement = { ...track, devices: [] };
                } else if (change === 'same-id-type-successor') {
                    replacement = {
                        ...track,
                        devices: [{ ...makeDevice('builtin-synth-brass'), parameterValues: { attack: 0.8 } }],
                    };
                }
                const tracks = [replacement, ...state.tracks.slice(1)];
                if (change === 'duplicate-device-owner') {
                    tracks.push({ ...track, id: 'other-track' });
                }
                if (change === 'duplicate-track-owner') {
                    tracks.push({ ...track, devices: [] });
                }
                trackStore.set({ ...state, tracks });
            });
            write.commit();
        });
        try {
            await entered.promise;
            end(canvas);
            expect(depth()).toBe(0);
            if (change === 'project-epoch') {
                await activateProject();
                engineWrites.length = 0;
            }
            await act(async () => {
                release.resolve();
                await snapshot;
            });
            await drainActions();
            expect(depth()).toBe(0);
            expect(rawTracks()).toEqual(trackStore.value?.tracks);
            if (change === 'value') {
                expect(rawValues().attack).toBe(0.8);
                expect(writes().at(-1)?.value).toBe(0.8);
            } else if (change === 'same-id-type-successor') {
                expect(rawValues()).toEqual({ attack: 0.8 });
                expect(writes().map((entry) => entry.value)).toEqual([expect.closeTo(0.45, 12)]);
            } else if (change === 'project-epoch') {
                expect(rawValues()).toEqual(INITIAL_ENVELOPE);
                expect(writes()).toEqual([]);
            } else if (change === 'device-removed') {
                expect(rawTracks()[0]?.devices).toEqual([]);
                expect(writes()).toHaveLength(1);
            } else {
                expect(rawValues()).toEqual(INITIAL_ENVELOPE);
                expect(writes().map((entry) => entry.value)).toEqual(
                    change === 'frozen' ? [expect.closeTo(0.45, 12), 0.5] : [expect.closeTo(0.45, 12)]
                );
            }
        } finally {
            await act(async () => {
                release.resolve();
                await snapshot;
            });
        }
    });

    it.each(['builtin-synth', 'builtin-synth-strings'] as const)(
        'fences a live %s preview from a same-ID incoming project',
        async (type) => {
            seed(type);
            render(<Layout />);
            const canvas = begin('release', type);
            move(0.45);
            await act(() => activateProject());
            act(() => seed(type));
            engineWrites.length = 0;
            move(0.15, canvas);
            end(canvas);
            await drainActions();
            expect(rawValues()).toEqual(INITIAL_ENVELOPE);
            expect(depth()).toBe(0);
            expect(writes()).toEqual([]);
        }
    );

    it.each(['read', 'touch', 'write', 'latch'] as const)(
        'records only physical stage samples in %s mode across the real final queue',
        async (mode) => {
            recordMode(mode);
            const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
            let beat = 1;
            setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => beat });
            render(<Layout />);
            begin('sustain');
            const samples = [0.15, 0.35, 0.45];
            for (const [index, sample] of samples.entries()) {
                beat = index + 1;
                move(sample);
            }
            expect(writes().map(({ paramId, value }) => [paramId, value])).toEqual(
                samples.map((value) => ['sustain', expect.closeTo(value, 12)])
            );
            let expected: unknown[] = [];
            if (mode !== 'read') {
                expected = samples.map((sample, index) => [
                    'track-1',
                    `${DEVICE_ID}:sustain`,
                    expect.closeTo(sample, 12),
                    index + 1,
                ]);
            }
            expect(recording.mock.calls).toEqual(expected);
            const entered = Promise.withResolvers<void>();
            const release = Promise.withResolvers<void>();
            const snapshot = transactSnapshot(async () => {
                entered.resolve();
                await release.promise;
            });
            try {
                await entered.promise;
                beat = 4;
                end();
                expect(recording.mock.calls).toEqual(expected);
                expect(rawValues().sustain).toBe(0.5);
                expect(depth()).toBe(0);
                beat = 19;
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
                await committed('builtin-synth', 'sustain', 0.45);
                await act(() => undo());
                await act(() => redo());
                expect(recording.mock.calls).toEqual(expected);
                stopAutomationRecording(3);
                expect(automationStore.value?.lanes[0]?.points.map(({ beat: at, value }) => [at, value])).toEqual(
                    mode === 'read' ? [] : samples.map((value, index) => [index + 1, expect.closeTo(value, 12)])
                );
            } finally {
                await act(async () => {
                    release.resolve();
                    await snapshot;
                });
            }
        }
    );

    it('does not record cancellation as a delayed touch sample', async () => {
        recordMode('touch');
        const recording = vi.spyOn(automationUseCases, 'recordAutomationValue');
        setGestureClockSource({ getAudioTimeSeconds: () => 0, readNativeCursorBeats: () => 2 });
        render(<Layout />);
        const canvas = begin('sustain');
        move(0.45);
        fireEvent.pointerCancel(canvas, { pointerId: 5 });
        end(canvas);
        await drainActions();
        expect(recording.mock.calls).toEqual([['track-1', `${DEVICE_ID}:sustain`, expect.closeTo(0.45, 12), 2]]);
        expect(writes().map((entry) => entry.value)).toEqual([expect.closeTo(0.45, 12), 0.5]);
        expect(depth()).toBe(0);
    });

    it.each(
        [
            ...stages.map((stage) => ({ type: 'builtin-synth' as const, stage })),
            { type: 'builtin-synth-mellotron' as const, stage: 'attack' as const },
            { type: 'builtin-synth-strings' as const, stage: 'release' as const },
            { type: 'builtin-synth-808bass' as const, stage: 'sustain' as const },
            { type: 'builtin-synth-brass' as const, stage: 'attack' as const },
        ].flatMap((entry) => [false, true].map((absent) => ({ ...entry, absent })))
    )(
        'reconstructs real persisted $type $stage history with its initial field absent=$absent',
        async ({ type, stage, absent }) => {
            seed(type, absent ? stage : undefined);
            const before = structuredClone(rawValues());
            const original = nativeEnvelope(type)[stage];
            const finalValue = stage === 'release' ? 0.05 : 0.45;
            const view = render(<Layout />);
            begin(stage, type);
            move(finalValue);
            end();
            await committed(type, stage, finalValue);
            const liveEntry = undoStore.value?.past[0];
            expect(liveEntry).toBeDefined();
            await waitFor(() => expect(sessionStorage.getItem(SESSION_KEY)).toContain(stage));
            await persistCrdtProject();
            const witness = captureDurableDocumentWitness();
            const serialized = sessionStorage.getItem(SESSION_KEY);
            expect(serialized).not.toBeNull();
            const persisted: unknown = JSON.parse(serialized ?? 'null');
            expect(persisted).toMatchObject({ witness });
            view.unmount();
            removeCrdtDoc('root');
            expect(hasCrdtDoc('root')).toBe(false);
            createCrdtDoc('root');
            await expect(loadCrdtProject()).resolves.toBe(true);
            act(() => projectCrdtToStores({ resetProjections: true }));
            expect(captureDurableDocumentWitness()).toBe(witness);
            expect(rawValues()[stage]).toBeCloseTo(finalValue, 12);
            expect(values()[stage]).toBeCloseTo(finalValue, 12);
            clearHandlerRegistry();
            registerProductionCommandHandlers(getProductionCommandHandlerMaps({ canMutateBranchMetadata: () => true }));
            reconcileSessionUndoForProject({ projectId: PROJECT_ID, captureWitness: captureDurableDocumentWitness });
            expect(depth()).toBe(1);
            expect(undoStore.value?.past[0]).not.toBe(liveEntry);
            render(<Layout />);
            await act(() => undo());
            expect(rawValues()).toEqual(before);
            expect(values()).toEqual(before);
            expect(writes().at(-1)).toMatchObject({ paramId: stage, value: original });
            expectStageValue(type, stage, original);
            await act(() => redo());
            expect(rawValues()[stage]).toBeCloseTo(finalValue, 12);
            expect(values()[stage]).toBeCloseTo(finalValue, 12);
            expectStageValue(type, stage, finalValue);
            expect(writes().at(-1)).toMatchObject({ paramId: stage, value: expect.closeTo(finalValue, 12) });
        }
    );
});
