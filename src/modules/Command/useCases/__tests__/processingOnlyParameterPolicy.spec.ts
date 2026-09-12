import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { flushAutomergeStorageWrites } from '#/infra/store/storage/createAutomergeStorage';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import {
    createTrack,
    getArrangementHandlers,
    getTrackStoreState,
    setArrangementEventBus,
    setTrackStoreState,
} from '#/modules/Arrangement/useCases';
import { getAudioRenderingHandlers } from '#/modules/AudioRendering/useCases';
import { automationStore } from '#/modules/Automation/stores';
import {
    createAutomationLane,
    getAutomationHandlers,
    isRecordingAutomation,
    recordAutomationValue,
    setAutomationRecordingDependencies,
    stopAutomationRecording,
} from '#/modules/Automation/useCases';
import { getDrumPreviewBranchHandlers } from '#/modules/CrdtDocument/useCases';
import { getMidiNoteTransformHandlers } from '#/modules/MIDI/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { getTransportHandlers } from '#/modules/Transport/useCases';
import { getYeastHandlers } from '#/modules/Yeast/useCases';
import { type AppAction } from '#/utils/handlerContract';

import { clearHandlerRegistry } from '../../stores';
import { undoStore } from '../../stores/undoStore';
import { setActionHistoryMetadataPort } from '../actionHistoryMetadataPort';
import { commandBatchPreflightPort } from '../commandBatchPreflightPort';
import { commandProjectRevisionPort } from '../commandProjectRevisionPort';
import { compilePartialCommandBatchAcceptance } from '../compilePartialCommandBatchAcceptance';
import { compileVersionedCommandBatchEnvelope } from '../compileVersionedCommandBatchEnvelope';
import { createExecutionCommandEnvelope } from '../createExecutionCommandEnvelope';
import { executeAppAction } from '../executeAppAction';
import { getCommandBatchContentHash } from '../getCommandBatchContentHash';
import { getExecutableCommandRegistration } from '../getExecutableCommandRegistration';
import { getProjectCommandBatchIdempotencyCheckpoint } from '../getProjectCommandBatchIdempotencyCheckpoint';
import { issueCommandApprovalBinding } from '../issueCommandApprovalBinding';
import { parseVersionedCommandBatchEnvelope } from '../parseVersionedCommandBatchEnvelope';
import { parseVersionedCommandEnvelope } from '../parseVersionedCommandEnvelope';
import { partialCommandBatchSelection } from '../partialCommandBatchSelection';
import { persistProjectCommandBatchIdempotencyCheckpoint } from '../persistProjectCommandBatchIdempotencyCheckpoint';
import { redo } from '../redo';
import { registerProductionCommandHandlers } from '../registerProductionCommandHandlers';
import { resolveVersionedCommandBatchBindings } from '../resolveVersionedCommandBatchBindings';
import { serializeVersionedCommandEnvelope } from '../serializeVersionedCommandEnvelope';
import { undo } from '../undo';

import { executeApprovedVersionedCommandBatchEnvelope } from './commandApprovalTestFixture';

const TRACK_ID = 'track-mix';
const DEVICE_ID = 'device-filter';
const PARAM_ID = 'filter-cutoff';
const GAIN_LANE_ID = 'lane-gain';
const PAN_LANE_ID = 'lane-pan';
const DEVICE_LANE_ID = 'lane-device';
const REVISION = 'revision-processing-only';
const PROJECT_ID = 'project-processing-only';
const INITIAL_CUTOFF = 1_000;
const INITIAL_GAIN = 1;
const INITIAL_PAN = 0;

const mocks = vi.hoisted(() => ({
    engineSetTrackGain: vi.fn<(trackId: string, gain: number) => void>(),
    engineSetTrackPan: vi.fn<(trackId: string, pan: number) => void>(),
    updateDeviceParam: vi.fn(),
}));

// The engine adapters are the only seam this spec stands in for: everything
// between the envelope and the automation-recording maps is production code.
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: mocks.engineSetTrackGain,
    setTrackPan: mocks.engineSetTrackPan,
    updateDeviceParam: mocks.updateDeviceParam,
}));

type PolicyOptions = { suppressed: boolean };

function deviceParameterAction(input: PolicyOptions & { value: number }): AppAction {
    return {
        type: 'setDeviceParameter',
        payload: {
            deviceId: DEVICE_ID,
            paramId: PARAM_ID,
            value: input.value,
            ...(input.suppressed ? { automationRecordingPolicy: 'suppressed' as const } : {}),
        },
    };
}

function trackGainAction(input: PolicyOptions & { expectedGain?: number; gain: number }): AppAction {
    return {
        type: 'setTrackGain',
        payload: {
            trackId: TRACK_ID,
            gain: input.gain,
            expectedGain: input.expectedGain ?? INITIAL_GAIN,
            ...(input.suppressed ? { automationRecordingPolicy: 'suppressed' as const } : {}),
        },
    };
}

function trackPanAction(input: PolicyOptions & { expectedPan?: number; pan: number }): AppAction {
    return {
        type: 'setTrackPan',
        payload: {
            trackId: TRACK_ID,
            pan: input.pan,
            expectedPan: input.expectedPan ?? INITIAL_PAN,
            ...(input.suppressed ? { automationRecordingPolicy: 'suppressed' as const } : {}),
        },
    };
}

function envelopeFor(action: AppAction): ReturnType<typeof createExecutionCommandEnvelope>['envelope'] {
    return createExecutionCommandEnvelope({
        action,
        expectedEffect: `Execute ${action.type}`,
        normalizedProjectRevision: REVISION,
    }).envelope;
}

function compileBatch(input: { actions: readonly AppAction[]; batchId?: string }) {
    return compileVersionedCommandBatchEnvelope({
        baseRevision: REVISION,
        batchId: input.batchId ?? 'batch-processing-only',
        commands: input.actions.map((action) => JSON.stringify(envelopeFor(action))),
        intent: 'Apply a static mix adjustment',
        mode: 'commit',
        projectId: PROJECT_ID,
        runId: 'run-processing-only',
    });
}

function executeBatch(compiled: ReturnType<typeof compileBatch>) {
    return executeApprovedVersionedCommandBatchEnvelope({
        approvalBinding: issueCommandApprovalBinding({
            authority: compiled.authority,
            serialized: compiled.serialized,
            validate: () => ({ status: 'valid' }),
        }),
        authority: compiled.authority,
        serialized: compiled.serialized,
    });
}

function laneById(laneId: string) {
    return automationStore.value?.lanes.find((lane) => lane.id === laneId);
}

function allLanePoints(): Record<string, number> {
    return Object.fromEntries(
        (automationStore.value?.lanes ?? []).map((lane) => [lane.id, lane.points.length] as const)
    );
}

function currentTrack() {
    return getTrackStoreState()?.tracks.find((track) => track.id === TRACK_ID);
}

function currentCutoff(): number | undefined {
    return currentTrack()?.devices.find((device) => device.id === DEVICE_ID)?.parameterValues[PARAM_ID];
}

function playInWriteMode(): void {
    transportStore.set({ ...defaultTransportState, isPlaying: true, playheadPosition: 4 });
}

function seedProject(): void {
    const track = createTrack({ id: TRACK_ID, kind: 'audio', name: 'Mix' });
    track.automationMode = 'write';
    track.gain = INITIAL_GAIN;
    track.pan = INITIAL_PAN;
    track.devices = [
        {
            id: DEVICE_ID,
            name: 'Filter',
            type: 'builtin-filter',
            bypassed: false,
            parameterValues: { [PARAM_ID]: INITIAL_CUTOFF },
        },
    ];
    setTrackStoreState({ ...defaultTrackState, tracks: [track] });
    automationStore.set({
        lanes: [
            { ...createAutomationLane(TRACK_ID, 'gain', 'Gain'), id: GAIN_LANE_ID },
            { ...createAutomationLane(TRACK_ID, 'pan', 'Pan', -1, 1), id: PAN_LANE_ID },
            {
                ...createAutomationLane(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`, 'Cutoff', 0, 20_000),
                id: DEVICE_LANE_ID,
            },
        ],
    });
}

function registerProductionHandlers(): void {
    registerProductionCommandHandlers([
        getArrangementHandlers(),
        getAudioRenderingHandlers(),
        getAutomationHandlers(),
        getDrumPreviewBranchHandlers({ canMutateBranchMetadata: () => true }),
        getMidiNoteTransformHandlers(),
        getTransportHandlers(),
        getYeastHandlers(),
    ]);
}

describe('processing-only parameter policy', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        // The project stores are CRDT-backed and no document is wired here, so
        // the seeded project lives only in the optimistic pending write this
        // fixture makes. jsdom's animation frame is a 16ms timer: were it to fire
        // between the seed and a batch, the frameless flush would release that
        // pending write, and the abort below would then recompute the store from
        // a committed value that never existed — dropping the whole track instead
        // of restoring its pre-batch parameter. Release any frame already armed,
        // then hold the frame for the test so the seed stays the fixture.
        flushAutomergeStorageWrites();
        vi.stubGlobal('requestAnimationFrame', () => 0);
        sessionStorage.removeItem('sourdaw-undo-session');
        clearHandlerRegistry();
        undoStore.set({ past: [], future: [] });
        setActionHistoryMetadataPort({
            record: () => [],
            markReverted: () => ({ status: 'unavailable' as const }),
            clear: () => undefined,
        });
        setArrangementEventBus({ emit: () => Promise.resolve() });
        setAutomationRecordingDependencies({
            getAudioContext: () => ({ baseLatency: 0, outputLatency: 0 }) as AudioContext,
            getCompensationDelay: () => 0,
        });
        commandProjectRevisionPort.setProvider(() => REVISION);
        commandBatchPreflightPort.setProvider(() => ({
            audioGraphValid: true,
            availableAssetHashes: [],
            availableAudioBufferIds: [],
            lockedRanges: [],
            projectId: PROJECT_ID,
            projectInvariantsValid: true,
            targetFingerprints: {
                [DEVICE_ID]: 'device',
                [DEVICE_LANE_ID]: 'lane',
                [GAIN_LANE_ID]: 'lane',
                [PAN_LANE_ID]: 'lane',
                [PARAM_ID]: 'parameter',
                [TRACK_ID]: 'track',
            },
        }));
        seedProject();
        transportStore.set({ ...defaultTransportState });
        registerProductionHandlers();
    });

    afterEach(() => {
        stopAutomationRecording();
        clearHandlerRegistry();
        commandBatchPreflightPort.setProvider(null);
        commandProjectRevisionPort.setProvider(null);
        undoStore.set({ past: [], future: [] });
        automationStore.set({ lanes: [] });
        trackStore.set({ ...defaultTrackState });
        transportStore.set({ ...defaultTransportState });
        sessionStorage.removeItem('sourdaw-undo-session');
        vi.unstubAllGlobals();
    });

    it('commits a suppressed batch while playing in write mode without opening a recording pass', async () => {
        playInWriteMode();

        const result = await executeBatch(
            compileBatch({
                actions: [
                    deviceParameterAction({ suppressed: true, value: 400 }),
                    trackGainAction({ gain: 0.5, suppressed: true }),
                    trackPanAction({ pan: -20, suppressed: true }),
                ],
            })
        );

        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(currentCutoff()).toBe(400);
        expect(currentTrack()?.gain).toBe(0.5);
        expect(currentTrack()?.pan).toBe(-20);
        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(false);
        expect(isRecordingAutomation(TRACK_ID, 'pan')).toBe(false);
        expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`)).toBe(false);
        expect(allLanePoints()).toEqual({ [DEVICE_LANE_ID]: 0, [GAIN_LANE_ID]: 0, [PAN_LANE_ID]: 0 });

        // A later stop is what would flush a pass that had been opened, so it is
        // the observation that separates "buffered but not yet written" from
        // "never started".
        stopAutomationRecording();
        expect(allLanePoints()).toEqual({ [DEVICE_LANE_ID]: 0, [GAIN_LANE_ID]: 0, [PAN_LANE_ID]: 0 });
        expect(undoStore.value?.past.some((entry) => entry.label === 'Record Automation')).toBe(false);
    });

    it('records the same batch as a gesture pass when no command declares the policy', async () => {
        playInWriteMode();

        const result = await executeBatch(
            compileBatch({
                actions: [
                    deviceParameterAction({ suppressed: false, value: 400 }),
                    trackGainAction({ gain: 0.5, suppressed: false }),
                    trackPanAction({ pan: -20, suppressed: false }),
                ],
            })
        );

        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(true);
        expect(isRecordingAutomation(TRACK_ID, 'pan')).toBe(true);
        expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`)).toBe(true);

        stopAutomationRecording();
        expect(laneById(GAIN_LANE_ID)?.points).toHaveLength(1);
        expect(laneById(PAN_LANE_ID)?.points).toHaveLength(1);
        expect(laneById(DEVICE_LANE_ID)?.points).toHaveLength(1);
    });

    it('records nothing from a suppressed command whose transport started playing mid-batch', async () => {
        // The batch begins stopped; the first command's engine write starts
        // playback in write mode, so the later command's setter reads a live
        // transport rather than the one the batch was planned against.
        mocks.engineSetTrackGain.mockImplementation(() => {
            playInWriteMode();
        });

        const result = await executeBatch(
            compileBatch({
                actions: [
                    trackGainAction({ gain: 0.5, suppressed: true }),
                    deviceParameterAction({ suppressed: true, value: 400 }),
                    trackPanAction({ pan: -20, suppressed: true }),
                ],
            })
        );

        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(transportStore.value?.isPlaying).toBe(true);
        expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`)).toBe(false);
        expect(isRecordingAutomation(TRACK_ID, 'pan')).toBe(false);
        stopAutomationRecording();
        expect(allLanePoints()).toEqual({ [DEVICE_LANE_ID]: 0, [GAIN_LANE_ID]: 0, [PAN_LANE_ID]: 0 });
    });

    it('records from an unsuppressed command whose transport started playing mid-batch', async () => {
        mocks.engineSetTrackGain.mockImplementation(() => {
            playInWriteMode();
        });

        const result = await executeBatch(
            compileBatch({
                actions: [
                    trackGainAction({ gain: 0.5, suppressed: true }),
                    deviceParameterAction({ suppressed: false, value: 400 }),
                ],
            })
        );

        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`)).toBe(true);
    });

    it('leaves a manual pass that grew during an aborting suppressed batch untouched', async () => {
        playInWriteMode();
        recordAutomationValue(TRACK_ID, 'gain', 0.9, 1);
        recordAutomationValue(TRACK_ID, 'gain', 0.7, 2);
        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(true);
        // A fader the user is still riding keeps feeding the same pass while the
        // batch runs, and the batch then fails after the device parameter wrote.
        // Only a suppressed edit leaves that later point alone: a snapshot taken
        // at `prepareAbort` would rewind the pass to its pre-batch contents.
        mocks.engineSetTrackPan.mockImplementation(() => {
            recordAutomationValue(TRACK_ID, 'gain', 0.55, 3);
            throw new Error('engine refused the pan write');
        });

        const result = await executeBatch(
            compileBatch({
                actions: [
                    deviceParameterAction({ suppressed: true, value: 400 }),
                    trackPanAction({ pan: -20, suppressed: true }),
                ],
            })
        );

        expect(result.status).not.toBe('committed');
        expect(currentCutoff(), JSON.stringify({ result, track: currentTrack() })).toBe(INITIAL_CUTOFF);
        expect(mocks.updateDeviceParam).toHaveBeenLastCalledWith(TRACK_ID, DEVICE_ID, PARAM_ID, INITIAL_CUTOFF);
        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(true);

        stopAutomationRecording();
        expect(laneById(GAIN_LANE_ID)?.points.map((point) => point.value)).toEqual([0.9, 0.7, 0.55]);
    });

    it('undoes and redoes a committed suppressed batch while playing without recording', async () => {
        const result = await executeBatch(
            compileBatch({
                actions: [
                    deviceParameterAction({ suppressed: true, value: 400 }),
                    trackGainAction({ gain: 0.5, suppressed: true }),
                ],
            })
        );
        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });

        playInWriteMode();
        expect(await undo()).toEqual({ headConsumed: true });
        expect(currentCutoff()).toBe(INITIAL_CUTOFF);
        expect(currentTrack()?.gain).toBe(INITIAL_GAIN);
        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(false);
        expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`)).toBe(false);

        await redo();
        expect(currentCutoff()).toBe(400);
        expect(currentTrack()?.gain).toBe(0.5);
        expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(false);
        expect(isRecordingAutomation(TRACK_ID, `${DEVICE_ID}:${PARAM_ID}`)).toBe(false);

        stopAutomationRecording();
        expect(allLanePoints()).toEqual({ [DEVICE_LANE_ID]: 0, [GAIN_LANE_ID]: 0, [PAN_LANE_ID]: 0 });
    });

    it('still lands an explicit automation point on the lane the suppressed edit left empty', async () => {
        playInWriteMode();

        const result = await executeBatch(
            compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: true })] })
        );
        expect(result, JSON.stringify(result)).toMatchObject({ status: 'committed' });
        expect(laneById(GAIN_LANE_ID)?.points).toEqual([]);

        // Suppression is about gesture recording, not about automation itself:
        // the model's own way of writing a curve is unaffected.
        await executeAppAction({
            type: 'addAutomationPoint',
            payload: { laneId: GAIN_LANE_ID, beat: 8, value: 0.25 },
        });

        expect(laneById(GAIN_LANE_ID)?.points.map((point) => point.value)).toEqual([0.25]);
    });

    describe('serialized boundary', () => {
        it.each([
            { name: 'setDeviceParameter', action: deviceParameterAction({ suppressed: true, value: 400 }) },
            { name: 'setTrackGain', action: trackGainAction({ gain: 0.5, suppressed: true }) },
            { name: 'setTrackPan', action: trackPanAction({ pan: -20, suppressed: true }) },
        ])('admits a suppressed $name command through the runtime schema', ({ action }) => {
            const parsed = parseVersionedCommandEnvelope(serializeVersionedCommandEnvelope(envelopeFor(action)));

            expect(parsed.status).toBe('valid');
        });

        it.each([{ value: 'allowed' }, { value: '' }, { value: true }, { value: null }])(
            'refuses $value as an automation recording policy',
            ({ value }) => {
                const envelope = envelopeFor(trackGainAction({ gain: 0.5, suppressed: true }));

                expect(
                    getExecutableCommandRegistration('setTrackGain').runtimeSchema.validate({
                        ...envelope.arguments,
                        automationRecordingPolicy: value,
                    })
                ).toBe(false);
            }
        );

        it('never publishes the policy through the provider-facing schema', () => {
            for (const actionType of ['setDeviceParameter', 'setTrackGain', 'setTrackPan'] as const) {
                expect(
                    Object.keys(getExecutableCommandRegistration(actionType).providerSchema.properties)
                ).not.toContain('automationRecordingPolicy');
            }
        });

        it('gives the suppressed batch a different content hash from the unsuppressed one', async () => {
            const suppressed = parseVersionedCommandBatchEnvelope(
                compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: true })] }).serialized
            );
            const plain = parseVersionedCommandBatchEnvelope(
                compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: false })] }).serialized
            );
            if (suppressed.status !== 'valid' || plain.status !== 'valid') {
                throw new Error('Expected both batches to parse');
            }

            expect(await getCommandBatchContentHash(suppressed.envelope)).not.toBe(
                await getCommandBatchContentHash(plain.envelope)
            );
        });

        it('refuses an approval binding minted for the unsuppressed batch before any handler runs', async () => {
            playInWriteMode();
            const plain = compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: false })] });
            const suppressed = compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: true })] });

            const result = await executeApprovedVersionedCommandBatchEnvelope({
                approvalBinding: issueCommandApprovalBinding({
                    authority: plain.authority,
                    serialized: plain.serialized,
                    validate: () => ({ status: 'valid' }),
                }),
                authority: suppressed.authority,
                serialized: suppressed.serialized,
            });

            expect(result).toMatchObject({ status: 'rejected' });
            expect(currentTrack()?.gain).toBe(INITIAL_GAIN);
            expect(isRecordingAutomation(TRACK_ID, 'gain')).toBe(false);
        });

        it('retains the policy through binding resolution and partial acceptance', () => {
            const compiled = compileBatch({
                actions: [
                    trackGainAction({ gain: 0.5, suppressed: true }),
                    trackPanAction({ pan: -20, suppressed: true }),
                ],
            });
            const parsed = parseVersionedCommandBatchEnvelope(compiled.serialized, compiled.authority);
            if (parsed.status !== 'valid') {
                throw new Error(parsed.reason);
            }

            expect(
                resolveVersionedCommandBatchBindings(parsed.envelope).map(
                    (command) => command.arguments.automationRecordingPolicy
                )
            ).toEqual(['suppressed', 'suppressed']);

            const partial = compilePartialCommandBatchAcceptance({
                batchId: 'batch-partial-processing-only',
                previewSelection: partialCommandBatchSelection.create(
                    parsed.envelope,
                    parsed.envelope.commands.map((command) => command.commandId)
                ),
                runId: 'run-partial-processing-only',
                selectedIntentGroupIds: [parsed.envelope.commands[1]!.commandId],
            });
            if (partial.status !== 'compiled') {
                throw new Error(partial.reason);
            }
            const parsedPartial = parseVersionedCommandBatchEnvelope(partial.serialized, partial.authority);
            if (parsedPartial.status !== 'valid') {
                throw new Error(parsedPartial.reason);
            }

            expect(
                parsedPartial.envelope.commands.map((command) => command.arguments.automationRecordingPolicy)
            ).toEqual(['suppressed']);
        });

        it('does not match a retained checkpoint minted for the unsuppressed batch', async () => {
            const plain = parseVersionedCommandBatchEnvelope(
                compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: false })] }).serialized
            );
            const suppressed = parseVersionedCommandBatchEnvelope(
                compileBatch({ actions: [trackGainAction({ gain: 0.5, suppressed: true })] }).serialized
            );
            if (plain.status !== 'valid' || suppressed.status !== 'valid') {
                throw new Error('Expected both batches to parse');
            }
            expect(plain.envelope.idempotencyKey).toBe(suppressed.envelope.idempotencyKey);
            persistProjectCommandBatchIdempotencyCheckpoint({
                contentHash: await getCommandBatchContentHash(plain.envelope),
                idempotencyKey: plain.envelope.idempotencyKey,
                projectId: PROJECT_ID,
                serializedReceipt: '{}',
                state: 'complete',
            });

            expect(
                getProjectCommandBatchIdempotencyCheckpoint({
                    contentHash: await getCommandBatchContentHash(suppressed.envelope),
                    idempotencyKey: suppressed.envelope.idempotencyKey,
                    projectId: PROJECT_ID,
                })
            ).toEqual({ status: 'conflict' });
        });
    });

    it('drops a persisted entry whose forward carries the policy but whose inverse does not', () => {
        const registration = getExecutableCommandRegistration('setTrackGain');
        const persistedEntry = {
            id: 'undo-suppressed-gain',
            kind: 'action',
            label: 'Set track gain',
            action: trackGainAction({ gain: 0.5, suppressed: true }),
            inverseAction: trackGainAction({ expectedGain: 0.5, gain: INITIAL_GAIN, suppressed: false }),
            redoAction: trackGainAction({ expectedGain: INITIAL_GAIN, gain: 0.5, suppressed: true }),
            timestamp: 1,
            source: 'ai',
            actionOperationVersion: registration.operationVersion,
            inverseActionOperationVersion: registration.operationVersion,
            redoActionOperationVersion: registration.operationVersion,
        };
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify({ past: [persistedEntry], future: [] }));
        clearHandlerRegistry();
        undoStore.set({ past: [], future: [] });

        registerProductionHandlers();

        expect(undoStore.value?.past).toEqual([]);
    });

    it('keeps a persisted entry whose forward, inverse and redo all carry the policy', () => {
        const registration = getExecutableCommandRegistration('setTrackGain');
        const persistedEntry = {
            id: 'undo-suppressed-gain',
            kind: 'action',
            label: 'Set track gain',
            action: trackGainAction({ gain: 0.5, suppressed: true }),
            inverseAction: trackGainAction({ expectedGain: 0.5, gain: INITIAL_GAIN, suppressed: true }),
            redoAction: trackGainAction({ expectedGain: INITIAL_GAIN, gain: 0.5, suppressed: true }),
            timestamp: 1,
            source: 'ai',
            actionOperationVersion: registration.operationVersion,
            inverseActionOperationVersion: registration.operationVersion,
            redoActionOperationVersion: registration.operationVersion,
        };
        sessionStorage.setItem('sourdaw-undo-session', JSON.stringify({ past: [persistedEntry], future: [] }));
        clearHandlerRegistry();
        undoStore.set({ past: [], future: [] });

        registerProductionHandlers();

        expect(undoStore.value?.past).toHaveLength(1);
    });
});
