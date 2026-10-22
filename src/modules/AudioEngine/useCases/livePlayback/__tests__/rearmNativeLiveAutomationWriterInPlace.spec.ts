/**
 * What a re-arm of a pass in flight re-reads (#3568, #3575).
 *
 * Both routes that arm an existing pass are here, because the contract belongs
 * to the arm rather than to either caller: an arm claims to re-project the whole
 * world — it clears the pending re-read on that claim — so a caller handing it
 * the arm-time strip objects would be arming against a chain the project has
 * moved past. The in-place re-arm and the locate share one store re-read for
 * exactly that reason, and this file proves both of them take it.
 *
 * Nothing that decides the answer is doubled: the real arm, the real producer,
 * the real stores. A chain re-arm exists precisely because a plugin reached
 * project truth after the pass was taken, so a double for the producer — or for
 * the re-arm itself — would stand exactly where the question is.
 *
 * The order the case is staged in is the order the mirror runs it: the project
 * chain changes first, the engine reports the chain it now holds, and the
 * re-arm follows. A device on project truth that the engine does not report is
 * still Web Audio's, which is a different case and belongs to
 * `isDeviceCarriedByNativeSession`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Container } from '#/infra/di/Container';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { trackStore, vcaGroupStore, type Device, type Track } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, registerHandlerMap } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
    redo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    recordActionHistoryEntry,
    markActionHistoryEntryReverted,
    clearActionHistory,
} from '#/modules/CrdtDocument/useCases';

import {
    type AudioGraphApplyResult,
    type AudioGraphCommand,
    type AudioGraphCommandBatch,
    type AudioGraphParameterWrite,
} from '../../../models/AudioGraphBackend';
import { offlineDeviceParameterLawState } from '../../../repositories/offlineScheduler/offlineDeviceParameterLawState';
import {
    offlinePpqEndpointProjectorState,
    type OfflinePpqEndpointProjector,
} from '../../../repositories/offlineScheduler/offlinePpqEndpointProjectorState';
import { armNativeLiveAutomationWriter } from '../armNativeLiveAutomationWriter';
import { disarmNativeLiveAutomationWriter } from '../disarmNativeLiveAutomationWriter';
import { nativeLiveAutomationWriter } from '../nativeLiveAutomationWriterState';
import { nativeLiveGraphSession } from '../nativeLiveGraphSessionState';
import { pumpNativeLiveAutomationWriter } from '../pumpNativeLiveAutomationWriter';
import { rearmNativeLiveAutomationWriterInPlace } from '../rearmNativeLiveAutomationWriterInPlace';
import { repositionNativeLiveGraphSession } from '../repositionNativeLiveGraphSession';

const SAMPLE_RATE = 48_000;
const SECONDS_PER_BEAT = 0.5;
const STRIP_ID = 'track-1';

/** Flat 120 BPM, which is the tempo an unset transport store answers with. */
const projectPpqEndpoints: OfflinePpqEndpointProjector = ({ startPpq, endPpq, sampleRate }) => {
    const startSamples = Math.round(startPpq * SECONDS_PER_BEAT * sampleRate);
    const endSamples = Math.round(endPpq * SECONDS_PER_BEAT * sampleRate);
    return {
        startSamples,
        endSamples,
        durationSamples: endSamples - startSamples,
        startSeconds: startSamples / sampleRate,
        endSeconds: endSamples / sampleRate,
        durationSeconds: (endSamples - startSamples) / sampleRate,
    };
};

function hostedDevice(id: string, instanceId: string): Device {
    return {
        id,
        name: id,
        type: 'external-plugin',
        bypassed: false,
        parameterValues: {},
        externalInstanceId: instanceId,
    };
}

const FIRST_PLUGIN = hostedDevice('plugin-1', 'instance-1');
/** The plugin the engineer drops into the chain mid-take. */
const SECOND_PLUGIN = hostedDevice('plugin-2', 'instance-2');

function trackHolding(devices: readonly Device[]): Track {
    return {
        id: STRIP_ID,
        name: 'Lead',
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#ff0000',
        clips: [],
        devices: [...devices],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'hw_out',
        automationMode: 'read',
        groupId: null,
        soloSafe: false,
        notes: '',
        inputId: null,
        activeAlternativeId: 'alt-1',
        alternatives: [{ id: 'alt-1', name: 'Alternative 1', clips: [] }],
        vcaGroupId: null,
        midiOutputTrackId: null,
        followChordTrack: false,
        midiFx: [],
    };
}

type StoredAutomationLane = NonNullable<typeof automationStore.value>['lanes'][number];

/** A lane on the plugin's own parameter 7, which is how a hosted id is spelled. */
function hostedLane(deviceId: string): StoredAutomationLane {
    return {
        id: `lane-${deviceId}`,
        trackId: STRIP_ID,
        parameterId: `${deviceId}:7`,
        parameterName: `${deviceId}:7`,
        enabled: true,
        visible: true,
        collapsed: false,
        objects: [],
        minValue: 0,
        maxValue: 1,
        points: [
            { beat: 0, value: 0.2, curve: 'step', tension: 0 },
            { beat: 2, value: 0.8, curve: 'step', tension: 0 },
        ],
    };
}

/** Which devices the pass in flight is currently stamping, in target order. */
function passDeviceIds(): readonly string[] {
    return (nativeLiveAutomationWriter.pass?.targets ?? []).flatMap((slot) =>
        slot.target.kind === 'device-parameter' ? [slot.target.deviceId] : []
    );
}

function publishProjectChain(devices: readonly Device[]): void {
    trackStore.set({ tracks: [trackHolding(devices)], selectedTrackId: null, ghostClips: [] });
}

function publishEngineChain(deviceIds: readonly string[]): void {
    nativeLiveGraphSession.nativeChainByStripId = new Map([[STRIP_ID, [...deviceIds]]]);
}

beforeEach(() => {
    offlinePpqEndpointProjectorState.project = projectPpqEndpoints;
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instanceId, parameterId) => parameterId === '7';
    offlineDeviceParameterLawState.clampExternalPluginValue = ({ value }) => value;
    offlineDeviceParameterLawState.quantiseValue = ({ value }) => value;
    automationStore.set({ lanes: [hostedLane(FIRST_PLUGIN.id), hostedLane(SECOND_PLUGIN.id)] });
    // No backend, so the arm's own pump returns before it sends anything: what
    // this file is about is the projection the pass holds, not the batch.
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.loopRegion = null;
    nativeLiveGraphSession.loopEnabled = false;
    nativeLiveGraphSession.carriedStripIds = new Set([STRIP_ID]);
    publishProjectChain([FIRST_PLUGIN]);
    publishEngineChain([FIRST_PLUGIN.id]);
});

afterEach(() => {
    disarmNativeLiveAutomationWriter();
    nativeLiveGraphSession.backend = null;
    nativeLiveGraphSession.rolling = false;
    vcaGroupStore.set({ groups: [] });
    offlinePpqEndpointProjectorState.project = null;
    offlineDeviceParameterLawState.acceptsExternalPluginParameter = null;
    offlineDeviceParameterLawState.clampExternalPluginValue = null;
    offlineDeviceParameterLawState.quantiseValue = null;
    automationStore.set({ lanes: [] });
    trackStore.set(null);
    nativeLiveAutomationWriter.pass = null;
    nativeLiveAutomationWriter.pendingRearm = null;
    nativeLiveGraphSession.carriedStripIds = new Set();
    nativeLiveGraphSession.nativeChainByStripId = new Map();
});

describe('live store edits on the existing writer pass', () => {
    const applied: AudioGraphApplyResult = {
        acceptance: 'accepted',
        application: 'applied',
        runtimeRevision: 1,
        admittedBatch: 11,
        reports: [],
    };
    const pump = () =>
        pumpNativeLiveAutomationWriter({
            positionSeconds: 0.02,
            loopWraps: 0,
            batchesApplied: 0,
            writerEpoch: nativeLiveAutomationWriter.epoch,
        });

    function deviceAWrites(commands: readonly AudioGraphCommand[]): readonly AudioGraphParameterWrite[] {
        return commands.flatMap((command) => {
            if (command.kind === 'write-device-parameter' && command.target.parameterId === '4') {
                return [command.write];
            }
            return [];
        });
    }

    // For this authored .1 -> .6 jump, the independent one-pole solution is
    // .6 - .5 * .6^n. The existing 5e-5 delivery gate emits ticks 1..17 and 19;
    // tick 18 and the final residual fit inside the last delivered value's bound.
    function editedTrajectory(regionStartSeconds: number): readonly { frame: number; value: number }[] {
        const firstMovingTick = Math.ceil((0.05 - regionStartSeconds) / 0.01);
        const deliveredTicks = [...Array.from({ length: 17 }, (_, index) => index + 1), 19];
        return [
            { frame: Math.round(regionStartSeconds * SAMPLE_RATE), value: 0.1 },
            ...deliveredTicks.map((tick) => ({
                frame: Math.round((regionStartSeconds + (firstMovingTick + tick - 1) * 0.01) * SAMPLE_RATE),
                value: 0.6 - 0.5 * 0.6 ** tick,
            })),
        ];
    }

    function expectTrajectory(
        writes: readonly AudioGraphParameterWrite[],
        expected: readonly { frame: number; value: number }[]
    ): void {
        expect(writes).toHaveLength(expected.length);
        for (const [index, write] of writes.entries()) {
            expect(write.shape).toBe('step');
            if (write.shape !== 'step') {
                throw new Error('the hosted lane must emit device Steps');
            }
            expect(Math.round(write.time * SAMPLE_RATE)).toBe(expected[index]!.frame);
            expect(write.value).toBeCloseTo(expected[index]!.value, 12);
        }
    }

    async function playingWith(
        lanes: readonly StoredAutomationLane[],
        respond: (batch: AudioGraphCommandBatch) => Promise<AudioGraphApplyResult> = async () => applied,
        strips: readonly Track[] = [trackHolding([FIRST_PLUGIN])],
        positionSeconds = 0
    ): Promise<AudioGraphCommandBatch[]> {
        automationStore.set({ lanes: [...lanes] });
        trackStore.set({ tracks: [...strips], selectedTrackId: null, ghostClips: [] });
        nativeLiveGraphSession.carriedStripIds = new Set(strips.map((track) => track.id));
        const batches: AudioGraphCommandBatch[] = [];
        nativeLiveGraphSession.pending = Promise.resolve();
        nativeLiveGraphSession.rolling = true;
        nativeLiveGraphSession.backend = {
            backendId: 'real-store-writer',
            apply: async (batch) => {
                batches.push(batch);
                return respond(batch);
            },
            dispose: () => undefined,
        };
        armNativeLiveAutomationWriter({
            stripTracks: strips,
            sampleRate: SAMPLE_RATE,
            programmeEndSeconds: 8,
            positionSeconds,
            provenAfterBatch: null,
        });
        await vi.waitFor(() => expect(nativeLiveAutomationWriter.inFlightEpoch).toBeNull());
        return batches;
    }

    it('cancels only edited/removed A and preserves B on the same effect and the unrelated strip cursor/stamps', async () => {
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instance, id) => id === '7' || id === '4';
        const a = {
            ...hostedLane(FIRST_PLUGIN.id),
            id: 'A',
            parameterId: `${FIRST_PLUGIN.id}:4`,
            points: [
                { beat: 0, value: 0.1, curve: 'step' as const, tension: 0 },
                { beat: 0.1, value: 0.9, curve: 'step' as const, tension: 0 },
            ],
        };
        const b = { ...hostedLane(FIRST_PLUGIN.id), id: 'B' };
        const other = { ...trackHolding([]), id: 'unrelated', name: 'Unrelated' };
        const pan = {
            ...b,
            id: 'pan',
            trackId: other.id,
            parameterId: 'pan',
            points: [{ beat: 0, value: 10, curve: 'step' as const, tension: 0 }],
        };
        const batches = await playingWith([a, b, pan], async () => applied, [trackHolding([FIRST_PLUGIN]), other]);
        const pass = nativeLiveAutomationWriter.pass!;
        const bystander = pass.targets.find(
            (slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '7'
        )!;
        const cursor = bystander.cursor;
        const stamps = [...bystander.queued];
        const otherSlot = pass.targets.find(
            (slot) => slot.target.kind === 'track-pan' && slot.target.trackId === other.id
        )!;
        const otherCursor = otherSlot.cursor;
        const otherStamps = [...otherSlot.queued];
        automationStore.set({
            lanes: [
                { ...a, points: a.points.map((point, index) => (index === 1 ? { ...point, value: 0.6 } : point)) },
                b,
                pan,
            ],
        });
        await pump();
        const commands = batches.at(-1)!.commands;
        expect(commands[0]).toMatchObject({
            kind: 'write-device-parameter',
            target: { parameterId: '4' },
            write: { shape: 'hold', time: 0.02 },
        });
        const edited = pass.targets.find(
            (slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '4'
        )!;
        const expected = editedTrajectory(0.02);
        expectTrajectory(edited.writes, expected);
        expectTrajectory(
            deviceAWrites(commands).filter((write) => write.shape === 'step'),
            expected.filter((step) => step.frame < 0.12 * SAMPLE_RATE)
        );
        const firstChanged = deviceAWrites(commands)[2]!;
        expect(firstChanged).toMatchObject({ shape: 'step', value: expect.closeTo(0.3, 12) });
        // The old .9-target curve would deliver .42 at this same first moving tick.
        expect(firstChanged).not.toMatchObject({ value: expect.closeTo(0.42, 12) });
        expect(pass.targets).toContain(bystander);
        expect(bystander.cursor).toBe(cursor);
        for (const [index, stamp] of stamps.entries()) {
            expect(bystander.queued[index]).toBe(stamp);
        }
        expect(pass.targets).toContain(otherSlot);
        expect(otherSlot.cursor).toBe(otherCursor);
        for (const [index, stamp] of otherStamps.entries()) {
            expect(otherSlot.queued[index]).toBe(stamp);
        }
        automationStore.set({ lanes: [b, pan] });
        await pump();
        expect(batches.at(-1)!.commands).toEqual([
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: STRIP_ID, deviceId: FIRST_PLUGIN.id, parameterId: '4' },
                write: { shape: 'hold', time: 0.02 },
            },
        ]);
        const count = batches.length;
        automationStore.set({ lanes: [structuredClone(b), pan] });
        await pump();
        expect(batches).toHaveLength(count);
    });

    it('retains newer dirty work across a pending accepted or refused batch and fences disarmed observers', async () => {
        const lane = hostedLane(FIRST_PLUGIN.id);
        const batches: AudioGraphCommandBatch[] = [];
        let mode: 'initial' | 'pending' | 'refused' | 'accepted' = 'initial';
        let settle!: (result: AudioGraphApplyResult) => void;
        let observed!: () => void;
        const sent = new Promise<void>((resolve) => {
            observed = resolve;
        });
        await playingWith([lane], async (batch) => {
            batches.push(batch);
            if (mode === 'pending') {
                observed();
                return new Promise((resolve) => {
                    settle = resolve;
                });
            }
            if (mode === 'refused') {
                return { acceptance: 'rejected', application: 'not-applied', reason: 'test refusal' };
            }
            return applied;
        });
        mode = 'pending';
        automationStore.set({ lanes: [{ ...lane, points: lane.points.map((point) => ({ ...point, value: 0.3 })) }] });
        const pending = pump();
        await sent;
        automationStore.set({ lanes: [] });
        settle(applied);
        await pending;
        mode = 'refused';
        await pump();
        expect(batches.at(-1)!.commands[0]).toMatchObject({ write: { shape: 'hold' } });
        mode = 'accepted';
        await pump();
        expect(batches.at(-1)!.commands[0]).toMatchObject({ write: { shape: 'hold' } });
        disarmNativeLiveAutomationWriter();
        automationStore.set({ lanes: [lane] });
        const count = batches.length;
        await pump();
        expect(batches).toHaveLength(count);
    });

    it('follows linked clip-scoped content and enabled/off transitions through the actual producer', async () => {
        const source = { ...hostedLane(FIRST_PLUGIN.id), id: 'source', trackId: 'source-only' };
        const linked = {
            ...hostedLane(FIRST_PLUGIN.id),
            id: 'linked',
            linkedLaneId: source.id,
            clipId: 'clip',
            points: [],
        };
        const track = trackHolding([FIRST_PLUGIN]);
        track.clips = [
            {
                id: 'clip',
                trackId: STRIP_ID,
                name: 'Clip',
                type: 'audio',
                startBeat: 0,
                endBeat: 4,
                fadeInBeats: 0,
                fadeOutBeats: 0,
                gain: 1,
                color: '#ff0000',
                locked: false,
                muted: false,
            },
        ];
        const batches = await playingWith([source, linked], async () => applied, [track]);
        automationStore.set({
            lanes: [{ ...source, points: source.points.map((point) => ({ ...point, value: 0.45 })) }, linked],
        });
        await pump();
        expect(batches.at(-1)!.commands[0]).toMatchObject({
            kind: 'write-device-parameter',
            target: { parameterId: '7' },
            write: { shape: 'hold' },
        });
        expect(
            batches
                .at(-1)!
                .commands.some(
                    (command) =>
                        command.kind === 'write-device-parameter' &&
                        command.write.shape === 'step' &&
                        command.write.value === 0.45
                )
        ).toBe(true);
        automationStore.set({ lanes: [source, { ...linked, enabled: false }] });
        await pump();
        expect(batches.at(-1)!.commands).toHaveLength(1);
        expect(batches.at(-1)!.commands[0]).toMatchObject({ write: { shape: 'hold' } });
        automationStore.set({ lanes: [source, linked] });
        await pump();
        trackStore.set({ tracks: [{ ...track, automationMode: 'off' }], selectedTrackId: null, ghostClips: [] });
        await pump();
        expect(batches.at(-1)!.commands).toHaveLength(1);
        expect(batches.at(-1)!.commands[0]).toMatchObject({ write: { shape: 'hold' } });
    });

    it('re-reads a same-id track/device replacement through its actual current instance law', async () => {
        offlineDeviceParameterLawState.clampExternalPluginValue = ({ externalInstanceId, value }) =>
            externalInstanceId === 'replacement' ? value / 2 : value;
        const lane = hostedLane(FIRST_PLUGIN.id);
        const original = trackHolding([FIRST_PLUGIN]);
        const batches = await playingWith([lane], async () => applied, [original]);
        const count = batches.length;
        trackStore.set({ tracks: [{ ...original, name: 'Renamed' }], selectedTrackId: null, ghostClips: [] });
        await pump();
        expect(batches).toHaveLength(count);
        trackStore.set({
            tracks: [{ ...original, devices: [{ ...FIRST_PLUGIN, externalInstanceId: 'replacement' }] }],
            selectedTrackId: null,
            ghostClips: [],
        });
        await pump();
        expect(batches.at(-1)!.commands[0]).toEqual({
            kind: 'write-device-parameter',
            target: { kind: 'device-parameter', trackId: STRIP_ID, deviceId: FIRST_PLUGIN.id, parameterId: '7' },
            write: { shape: 'hold', time: 0.02 },
        });
        expect(batches.at(-1)!.commands[1]).toMatchObject({ write: { shape: 'step', value: 0.1, time: 0.02 } });
    });

    it('uses the edited loop curve at the real seam and keeps the bystander loop slot', async () => {
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instance, id) => id === '7' || id === '4';
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 0, endSeconds: 1 };
        nativeLiveGraphSession.loopEnabled = true;
        const a: StoredAutomationLane = {
            ...hostedLane(FIRST_PLUGIN.id),
            id: 'A',
            parameterId: `${FIRST_PLUGIN.id}:4`,
            points: [
                { beat: 0, value: 0.1, curve: 'step', tension: 0 },
                { beat: 0.1, value: 0.9, curve: 'step', tension: 0 },
            ],
        };
        const b = { ...hostedLane(FIRST_PLUGIN.id), id: 'B' };
        let admittedBatch = 0;
        const batches = await playingWith([a, b], async () => ({ ...applied, admittedBatch: ++admittedBatch }));
        const pass = nativeLiveAutomationWriter.pass!;
        const epoch = nativeLiveAutomationWriter.epoch;
        const loopB = pass.loopTargets!.find(
            (slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '7'
        )!;
        automationStore.set({
            lanes: [
                { ...a, points: a.points.map((point, index) => (index === 1 ? { ...point, value: 0.6 } : point)) },
                b,
            ],
        });
        await pump();
        expect(pass.loopTargets).toContain(loopB);
        const seamBatchIndex = batches.length;
        await pumpNativeLiveAutomationWriter({
            positionSeconds: 0.01,
            loopWraps: 1,
            batchesApplied: admittedBatch,
            writerEpoch: epoch,
        });
        const expected = editedTrajectory(0);
        const seamWrites = deviceAWrites(batches.at(-1)!.commands);
        expectTrajectory(
            seamWrites,
            expected.filter((step) => step.frame < 0.11 * SAMPLE_RATE)
        );
        expect(seamWrites[1]).toMatchObject({ shape: 'step', value: expect.closeTo(0.3, 12) });
        expect(seamWrites[1]).not.toMatchObject({ value: expect.closeTo(0.42, 12) });
        expect(seamWrites.some((write) => write.shape === 'step' && write.value === 0.9)).toBe(false);
        expect(pass.targets).toContain(loopB);
        for (const positionSeconds of [0.11, 0.21, 0.31]) {
            const drainedBatch = admittedBatch;
            await pumpNativeLiveAutomationWriter({
                positionSeconds,
                loopWraps: 1,
                batchesApplied: drainedBatch,
                writerEpoch: epoch,
            });
            expect(nativeLiveAutomationWriter.epoch).toBe(epoch);
        }
        const delivered = batches.slice(seamBatchIndex).flatMap((batch) => deviceAWrites(batch.commands));
        expectTrajectory(delivered, expected);
        const tail = delivered.at(-1)!;
        expect(tail.shape).toBe('step');
        if (tail.shape !== 'step') {
            throw new Error('the delivered hosted tail must be a Step');
        }
        expect(tail.time).toBeGreaterThan(0.2);
        expect(tail.value).toBeLessThan(0.6);
        expect(0.6 - tail.value).toBeLessThanOrEqual(5e-5);
        expect(Math.abs(tail.value - 0.9)).toBeGreaterThan(0.29);
    });

    it('delivers an exact edited held value and its real loop wrap on the same epoch and admitted fences', async () => {
        offlineDeviceParameterLawState.acceptsExternalPluginParameter = (_instance, id) => id === '7' || id === '4';
        nativeLiveGraphSession.loopRegion = { enabled: true, startSeconds: 0.35, endSeconds: 1 };
        nativeLiveGraphSession.loopEnabled = true;
        const a: StoredAutomationLane = {
            ...hostedLane(FIRST_PLUGIN.id),
            id: 'A',
            parameterId: `${FIRST_PLUGIN.id}:4`,
            points: [
                { beat: 0, value: 0.1, curve: 'step', tension: 0 },
                { beat: 0.1, value: 0.9, curve: 'step', tension: 0 },
            ],
        };
        const b = { ...hostedLane(FIRST_PLUGIN.id), id: 'B' };
        let admittedBatch = 0;
        const batches = await playingWith(
            [a, b],
            async () => ({ ...applied, admittedBatch: ++admittedBatch }),
            [trackHolding([FIRST_PLUGIN])],
            0.35
        );
        const pass = nativeLiveAutomationWriter.pass!;
        const epoch = nativeLiveAutomationWriter.epoch;
        const pumpAtWrap = (loopWraps: number) =>
            pumpNativeLiveAutomationWriter({
                positionSeconds: 0.35,
                loopWraps,
                batchesApplied: admittedBatch,
                writerEpoch: epoch,
            });
        await pumpAtWrap(0);
        const bystander = pass.targets.find(
            (slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '7'
        )!;
        const loopB = pass.loopTargets!.find(
            (slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '7'
        )!;
        const cursor = bystander.cursor;
        const stamps = [...bystander.queued];
        expect(deviceAWrites(batches[0]!.commands)).toEqual([{ shape: 'step', value: 0.9, time: 0.35 }]);
        automationStore.set({
            lanes: [
                { ...a, points: a.points.map((point, index) => (index === 1 ? { ...point, value: 0.6 } : point)) },
                b,
            ],
        });
        await pumpAtWrap(0);
        const target = {
            kind: 'device-parameter',
            trackId: STRIP_ID,
            deviceId: FIRST_PLUGIN.id,
            parameterId: '4',
        };
        expect(batches.at(-1)!.commands).toEqual([
            { kind: 'write-device-parameter', target, write: { shape: 'hold', time: 0.35 } },
            { kind: 'write-device-parameter', target, write: { shape: 'step', value: 0.6, time: 0.35 } },
        ]);
        expect(pass.targets).toContain(bystander);
        expect(pass.loopTargets).toContain(loopB);
        expect(bystander.cursor).toBe(cursor);
        for (const [index, stamp] of stamps.entries()) {
            expect(bystander.queued[index]).toBe(stamp);
        }
        const edited = pass.targets.find(
            (slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '4'
        )!;
        expect(edited.queued.map((stamp) => stamp.admittedBatch)).toEqual([admittedBatch]);
        const editFence = admittedBatch;
        await pumpAtWrap(1);
        expect(admittedBatch).toBe(editFence + 1);
        expect(deviceAWrites(batches.at(-1)!.commands)).toEqual([{ shape: 'step', value: 0.6, time: 0.35 }]);
        expect(pass.targets).toContain(loopB);
        expect(nativeLiveAutomationWriter.epoch).toBe(epoch);
        expect(
            pass.targets
                .find((slot) => slot.target.kind === 'device-parameter' && slot.target.parameterId === '4')!
                .queued.some((stamp) => stamp.admittedBatch === admittedBatch)
        ).toBe(true);
    });

    it('does not let a late accepted edit advance a disarmed pass or clear its successor flight', async () => {
        const lane = hostedLane(FIRST_PLUGIN.id);
        let pending = false;
        let settle!: (result: AudioGraphApplyResult) => void;
        let observed!: () => void;
        const sent = new Promise<void>((resolve) => {
            observed = resolve;
        });
        await playingWith([lane], async () => {
            if (pending) {
                observed();
                return new Promise((resolve) => {
                    settle = resolve;
                });
            }
            return applied;
        });
        const outgoing = nativeLiveAutomationWriter.pass!;
        const acceptedRevision = outgoing.inputs.acceptedRevision;
        const oldSlot = outgoing.targets[0]!;
        const cursor = oldSlot.cursor;
        pending = true;
        automationStore.set({ lanes: [{ ...lane, points: lane.points.map((point) => ({ ...point, value: 0.3 })) }] });
        const flight = pump();
        await sent;
        disarmNativeLiveAutomationWriter();
        const retiredRevision = outgoing.inputs.revision;
        automationStore.set({ lanes: [{ ...lane, points: lane.points.map((point) => ({ ...point, value: 0.4 })) }] });
        expect(outgoing.inputs.revision).toBe(retiredRevision);
        pending = false;
        armNativeLiveAutomationWriter({
            stripTracks: [trackHolding([FIRST_PLUGIN])],
            sampleRate: SAMPLE_RATE,
            programmeEndSeconds: 8,
            positionSeconds: 0.02,
            provenAfterBatch: null,
        });
        const successor = nativeLiveAutomationWriter.pass!;
        expect(successor).not.toBe(outgoing);
        settle(applied);
        await flight;
        await vi.waitFor(() => expect(nativeLiveAutomationWriter.inFlightEpoch).toBeNull());
        expect(nativeLiveAutomationWriter.pass).toBe(successor);
        expect(outgoing.inputs.acceptedRevision).toBe(acceptedRevision);
        expect(oldSlot.cursor).toBe(cursor);
        expect(successor.targets[0]!.writes.some((write) => write.shape === 'step' && write.value === 0.4)).toBe(true);
        expect(successor.targets[0]!.cursor).toBeGreaterThan(0);
    });

    it('carries an unadmitted device edit through the real locate without pretending locate canceled its old stamps', async () => {
        const lane = hostedLane(FIRST_PLUGIN.id);
        const batches = await playingWith([lane]);
        const outgoing = nativeLiveAutomationWriter.pass!;
        const held = outgoing.targets[0]!.queued[0]!;
        automationStore.set({ lanes: [{ ...lane, points: lane.points.map((point) => ({ ...point, value: 0.4 })) }] });
        expect(await repositionNativeLiveGraphSession({ positionSeconds: 0.03 })).toEqual({ outcome: 'repositioned' });
        await vi.waitFor(() => expect(nativeLiveAutomationWriter.inFlightEpoch).toBeNull());
        expect(nativeLiveAutomationWriter.pass).not.toBe(outgoing);
        expect(batches.at(-1)!.commands).toEqual([
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: STRIP_ID, deviceId: FIRST_PLUGIN.id, parameterId: '7' },
                write: { shape: 'hold', time: 0.03 },
            },
            {
                kind: 'write-device-parameter',
                target: { kind: 'device-parameter', trackId: STRIP_ID, deviceId: FIRST_PLUGIN.id, parameterId: '7' },
                write: { shape: 'step', time: 0.03, value: 0.4 },
            },
        ]);
        expect(nativeLiveAutomationWriter.pass!.targets[0]!.queued).toContain(held);
    });

    it('uses actual solo and mute Steps without a Hold, curve or playhead move', async () => {
        const first = trackHolding([FIRST_PLUGIN]);
        const other = { ...trackHolding([]), id: 'other', name: 'Other' };
        const batches = await playingWith([], async () => applied, [first, other]);
        trackStore.set({ tracks: [first, { ...other, soloed: true }], selectedTrackId: null, ghostClips: [] });
        await pump();
        expect(batches.at(-1)!.commands).toEqual([
            {
                kind: 'write-parameter',
                target: { kind: 'track-solo-gate', trackId: STRIP_ID },
                write: { shape: 'step', time: 0.02, value: 0 },
            },
        ]);
        trackStore.set({ tracks: [{ ...first, muted: true }, other], selectedTrackId: null, ghostClips: [] });
        await pump();
        expect(batches.at(-1)!.commands).toEqual([
            {
                kind: 'write-parameter',
                target: { kind: 'track-solo-gate', trackId: STRIP_ID },
                write: { shape: 'step', time: 0.02, value: 1 },
            },
            {
                kind: 'write-parameter',
                target: { kind: 'track-mute-gate', trackId: STRIP_ID },
                write: { shape: 'step', time: 0.02, value: 0 },
            },
        ]);
        expect(nativeLiveAutomationWriter.pass?.targets).toEqual([]);
    });

    it('restores stored raw gain when the last fader lane is removed or switched off, atomically even at VCA zero', async () => {
        for (const change of ['remove', 'off'] as const) {
            for (const multiplier of [0, 1]) {
                disarmNativeLiveAutomationWriter();
                const track = { ...trackHolding([]), gain: 1.5, vcaGroupId: 'group' };
                const lane: StoredAutomationLane = {
                    ...hostedLane(FIRST_PLUGIN.id),
                    id: 'fader',
                    parameterId: 'gain',
                    minValue: -60,
                    maxValue: 12,
                    points: [{ beat: 0, value: -6, curve: 'step', tension: 0 }],
                };
                vcaGroupStore.set({
                    groups: [{ id: 'group', name: 'Group', gain: multiplier, muted: false, trackIds: [STRIP_ID] }],
                });
                let refused = false;
                const batches = await playingWith(
                    [lane],
                    async () => {
                        if (refused) {
                            return { acceptance: 'rejected', application: 'not-applied', reason: 'test refusal' };
                        }
                        return applied;
                    },
                    [track]
                );
                const pass = nativeLiveAutomationWriter.pass!;
                const fader = pass.targets.find((slot) => slot.target.kind === 'track-fader')!;
                expect(fader.writes.some((write) => write.shape === 'step' && write.value !== track.gain)).toBe(true);
                const stamps = [...fader.queued];
                const revision = pass.inputs.acceptedRevision;
                if (change === 'remove') {
                    automationStore.set({ lanes: [] });
                } else {
                    trackStore.set({
                        tracks: [{ ...track, automationMode: 'off' }],
                        selectedTrackId: null,
                        ghostClips: [],
                    });
                }
                const expected = [
                    {
                        kind: 'write-parameter',
                        target: { kind: 'track-fader', trackId: STRIP_ID },
                        write: { shape: 'hold', time: 0.02 },
                    },
                    {
                        kind: 'write-parameter',
                        target: { kind: 'track-fader', trackId: STRIP_ID },
                        write: { shape: 'step', time: 0.02, value: 1.5 },
                    },
                ];
                refused = true;
                await pump();
                expect(batches.at(-1)!.commands).toEqual(expected);
                expect(pass.targets).toContain(fader);
                expect(pass.inputs.acceptedRevision).toBe(revision);
                expect(pass.inputs.pending?.revision).toBeGreaterThan(revision);
                for (const [index, stamp] of stamps.entries()) {
                    expect(fader.queued[index]).toBe(stamp);
                }
                refused = false;
                await pump();
                expect(batches.at(-1)!.commands).toEqual(expected);
                expect(pass.inputs.acceptedRevision).toBeGreaterThan(revision);
                vcaGroupStore.set({
                    groups: [{ id: 'group', name: 'Group', gain: 0.5, muted: false, trackIds: [STRIP_ID] }],
                });
                await pump();
                expect(batches.at(-1)!.commands).toEqual([
                    { kind: 'set-strip-vca-multiplier', trackId: STRIP_ID, multiplier: 0.5 },
                    ...expected,
                ]);
            }
        }
    });

    it('carries an unadmitted fader removal across a real re-arm and retires the outgoing observations', async () => {
        const track = { ...trackHolding([]), gain: 1.5 };
        const lane: StoredAutomationLane = {
            ...hostedLane(FIRST_PLUGIN.id),
            parameterId: 'gain',
            minValue: -60,
            maxValue: 12,
            points: [{ beat: 0, value: -6, curve: 'step', tension: 0 }],
        };
        const batches = await playingWith([lane], async () => applied, [track]);
        const outgoing = nativeLiveAutomationWriter.pass!;
        automationStore.set({ lanes: [] });
        rearmNativeLiveAutomationWriterInPlace({ positionSeconds: 0.02, provenAfterBatch: 11 });
        await vi.waitFor(() => expect(nativeLiveAutomationWriter.inFlightEpoch).toBeNull());
        expect(nativeLiveAutomationWriter.pass).not.toBe(outgoing);
        expect(batches.at(-1)!.commands).toEqual([
            {
                kind: 'write-parameter',
                target: { kind: 'track-fader', trackId: STRIP_ID },
                write: { shape: 'hold', time: 0.02 },
            },
            {
                kind: 'write-parameter',
                target: { kind: 'track-fader', trackId: STRIP_ID },
                write: { shape: 'step', time: 0.02, value: 1.5 },
            },
        ]);
        const revision = outgoing.inputs.revision;
        automationStore.set({ lanes: [lane] });
        expect(outgoing.inputs.revision).toBe(revision);
        expect(nativeLiveAutomationWriter.pass!.inputs.revision).toBeGreaterThan(
            nativeLiveAutomationWriter.pass!.inputs.acceptedRevision
        );
    });

    it('replays raw gain after the owning typed VCA action with a gain lane, without one and with automation off', async () => {
        Container.clear();
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        try {
            for (const { automationMode, withLane } of [
                { automationMode: 'read', withLane: true },
                { automationMode: 'read', withLane: false },
                { automationMode: 'off', withLane: true },
            ] as const) {
                disarmNativeLiveAutomationWriter();
                const track = { ...trackHolding([FIRST_PLUGIN]), gain: 1.5, vcaGroupId: 'group', automationMode };
                trackStore.set({ tracks: [track], selectedTrackId: null, ghostClips: [] });
                vcaGroupStore.set({
                    groups: [{ id: 'group', name: 'Group', gain: 0, muted: false, trackIds: [STRIP_ID] }],
                });
                const batches: AudioGraphCommandBatch[] = [];
                nativeLiveGraphSession.backend = {
                    backendId: 'vca-real-store',
                    apply: async (batch) => {
                        batches.push(batch);
                        return applied;
                    },
                    dispose: () => undefined,
                };
                const lanes: StoredAutomationLane[] = [];
                if (withLane) {
                    lanes.push({
                        ...hostedLane(FIRST_PLUGIN.id),
                        id: 'fader',
                        parameterId: 'gain',
                        minValue: -60,
                        maxValue: 12,
                        points: [{ beat: 0, value: 0, curve: 'step', tension: 0 }],
                    });
                }
                automationStore.set({ lanes });
                armNativeLiveAutomationWriter({
                    stripTracks: [track],
                    sampleRate: SAMPLE_RATE,
                    programmeEndSeconds: 8,
                    positionSeconds: 0,
                    provenAfterBatch: null,
                });
                await vi.waitFor(() => expect(nativeLiveAutomationWriter.inFlightEpoch).toBeNull());
                await executeAppAction({ type: 'setVcaGain', payload: { vcaGroupId: 'group', gain: 0.5 } });
                await pump();
                expect(batches.at(-1)!.commands).toEqual([
                    { kind: 'set-strip-vca-multiplier', trackId: STRIP_ID, multiplier: 0.5 },
                    {
                        kind: 'write-parameter',
                        target: { kind: 'track-fader', trackId: STRIP_ID },
                        write: { shape: 'hold', time: 0.02 },
                    },
                    {
                        kind: 'write-parameter',
                        target: { kind: 'track-fader', trackId: STRIP_ID },
                        write: { shape: 'step', value: withLane && automationMode === 'read' ? 1 : 1.5, time: 0.02 },
                    },
                ]);
                await undo();
                await pump();
                expect(batches.at(-1)!.commands[0]).toEqual({
                    kind: 'set-strip-vca-multiplier',
                    trackId: STRIP_ID,
                    multiplier: 0,
                });
                await redo();
                await pump();
                expect(batches.at(-1)!.commands[0]).toEqual({
                    kind: 'set-strip-vca-multiplier',
                    trackId: STRIP_ID,
                    multiplier: 0.5,
                });
                await executeAppAction({ type: 'removeFromVca', payload: { trackId: STRIP_ID } });
                await pump();
                expect(batches.at(-1)!.commands[0]).toEqual({
                    kind: 'set-strip-vca-multiplier',
                    trackId: STRIP_ID,
                    multiplier: 1,
                });
            }
        } finally {
            disarmNativeLiveAutomationWriter();
            setActionHistoryMetadataPort({
                record: () => [],
                markReverted: () => ({ status: 'unavailable' }),
                clear: () => undefined,
            });
            clearUndoHistory();
            resetActionReplayAuthority();
            clearActionHistory();
            clearHandlerRegistry();
            configureAutomergeStoragePort(null);
            removeCrdtDoc('root');
            Container.clear();
        }
    });
});

function armOverTheFirstPlugin(): void {
    armNativeLiveAutomationWriter({
        stripTracks: [trackHolding([FIRST_PLUGIN])],
        sampleRate: SAMPLE_RATE,
        programmeEndSeconds: 8,
        positionSeconds: 0,
        provenAfterBatch: null,
    });
}

describe('rearmNativeLiveAutomationWriterInPlace', () => {
    it('carries a plugin spliced into the chain after the pass was armed', () => {
        armOverTheFirstPlugin();

        expect(passDeviceIds()).toEqual([FIRST_PLUGIN.id]);

        publishProjectChain([FIRST_PLUGIN, SECOND_PLUGIN]);
        publishEngineChain([FIRST_PLUGIN.id, SECOND_PLUGIN.id]);

        rearmNativeLiveAutomationWriterInPlace({ provenAfterBatch: 4 });

        // Without this the strip is stranded: the pass carries no stamp for the
        // new plugin, while the tick path reads it as the engine's and stops
        // writing it over IPC — so neither engine drives it until the next play.
        expect(passDeviceIds()).toEqual([FIRST_PLUGIN.id, SECOND_PLUGIN.id]);
    });

    it('keeps the strip set the session built when a strip leaves project truth', () => {
        armOverTheFirstPlugin();

        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });

        rearmNativeLiveAutomationWriterInPlace({ provenAfterBatch: 4 });

        // `carriedStripIds` still names the strip, so dropping it here would
        // leave its devices driven by neither engine.
        expect(nativeLiveAutomationWriter.pass?.stripTracks.map((track) => track.id)).toEqual([STRIP_ID]);
    });
});

describe('repositionNativeLiveGraphSession', () => {
    beforeEach(() => {
        nativeLiveGraphSession.backend = {
            backendId: 'rearm-spec',
            apply: () =>
                Promise.resolve({ acceptance: 'accepted', application: 'applied', runtimeRevision: 1, reports: [] }),
            dispose: () => undefined,
        };
        nativeLiveGraphSession.rolling = true;
        nativeLiveGraphSession.pending = Promise.resolve();
    });

    afterEach(() => {
        nativeLiveGraphSession.backend = null;
        nativeLiveGraphSession.rolling = false;
    });

    it('re-arms the locate against the chain the store holds, not the one the pass was taken on', async () => {
        armOverTheFirstPlugin();

        publishProjectChain([FIRST_PLUGIN, SECOND_PLUGIN]);
        publishEngineChain([FIRST_PLUGIN.id, SECOND_PLUGIN.id]);

        await repositionNativeLiveGraphSession({ positionSeconds: 2 });

        // A locate is an arm, and an arm clears the re-read the pass owed. Arming
        // it against the pass's own strip objects would drop that request while
        // leaving the plugin behind it stamped by nobody.
        expect(passDeviceIds()).toEqual([FIRST_PLUGIN.id, SECOND_PLUGIN.id]);
    });
});
