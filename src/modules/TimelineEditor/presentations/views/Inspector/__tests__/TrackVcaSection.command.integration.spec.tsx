import { clone } from '@automerge/automerge';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { TooltipProvider } from '#/components/ui/tooltip';
import { configureAutomergeStoragePort } from '#/infra/store/storage/createAutomergeStorage';
import { useStore } from '#/infra/store/useStore';
import { type Track, trackStore, vcaGroupStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers, setVcaRuntimeProjectionDependencies } from '#/modules/Arrangement/useCases';
import { automationStore } from '#/modules/Automation/stores';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import * as command from '#/modules/Command/useCases';
import { actionHistoryStore, agentProjectRepairStateStore } from '#/modules/CrdtDocument/stores';
import {
    captureProjectIdentity,
    clearActionHistory,
    createCrdtDoc,
    getCrdtDoc,
    markActionHistoryEntryReverted,
    mutateCrdtDoc,
    projectCrdtToStores,
    recordActionHistoryEntry,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    replaceCrdtDoc,
    resetCrdtProjectAuthority,
    settlePendingProjectWritesAndCaptureRevision,
    transactSnapshot,
} from '#/modules/CrdtDocument/useCases';
import { runProjectLoadTransaction, setProjectIdentityTransitionDependencies } from '#/modules/Project/useCases';
import { playheadPositionRef } from '#/modules/Transport/stores';
import { reconcileVcaRuntimeGain } from '#/modules/Transport/useCases';
import { notifyUser } from '#/utils/Notification/notifyUser';

import { TrackVcaSection } from '../TrackVcaSection';

// Command, handlers, CRDT, automation evaluation and committed reconciliation stay real.
// Only the engine boundary is controlled: Vitest has no live audio graph.
const engine = vi.hoisted(() => ({
    setTrackGain: vi.fn<(trackId: string, gain: number) => void>(),
    scheduleTrackGain: vi.fn<(trackId: string, gain: number, time: number) => void>(),
}));
vi.mock('#/modules/AudioEngine/useCases', async (importOriginal) => ({
    ...(await importOriginal<typeof import('#/modules/AudioEngine/useCases')>()),
    setTrackGain: engine.setTrackGain,
    scheduleTrackGain: engine.scheduleTrackGain,
    getCurrentTime: () => 10,
    getCompensationDelay: () => 0.25,
}));
vi.mock('#/utils/Notification/notifyUser', () => ({ notifyUser: vi.fn() }));

type Groups = NonNullable<typeof vcaGroupStore.value>;
type RawDocument = { tracks: { tracks: Track[] }; vcaGroups: Groups };
type Gesture = 'create' | 'assign' | 'none';
const noMetadata = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

function testTrack(id: string, name: string): Track {
    return {
        id,
        name,
        kind: 'audio',
        muted: false,
        soloed: false,
        armed: false,
        gain: 0.8,
        pan: 0,
        color: '#00ff88',
        clips: [],
        devices: [],
        sends: [],
        frozen: false,
        freezeState: { status: 'unfrozen' },
        parentId: null,
        collapsed: false,
        inputMonitoring: 'auto',
        hidden: false,
        disabled: false,
        height: 80,
        outputId: 'master',
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

function rawState() {
    const doc = getCrdtDoc<RawDocument>('root');
    if (!doc) {
        throw new Error('Expected real root document');
    }
    return structuredClone({ tracks: doc.tracks.tracks, groups: doc.vcaGroups.groups });
}

function projectedState() {
    return structuredClone({ tracks: trackStore.value?.tracks, groups: vcaGroupStore.value?.groups });
}

function Inspector() {
    const state = useStore(trackStore);
    const track = state?.tracks.find((candidate) => candidate.id === 'subject');
    if (!track || track.kind !== 'audio') {
        throw new Error('Expected audio Inspector target');
    }
    return (
        <TooltipProvider>
            <TrackVcaSection track={{ ...track, kind: track.kind }} />
        </TooltipProvider>
    );
}

function gesture(kind: Gesture): void {
    if (kind === 'create') {
        fireEvent.click(screen.getByRole('button', { name: 'Create VCA group' }));
        return;
    }
    fireEvent.change(screen.getByRole('combobox', { name: 'VCA group' }), {
        target: { value: kind === 'assign' ? 'destination' : '' },
    });
}

function lane(trackId: string) {
    return {
        id: `gain-${trackId}`,
        trackId,
        parameterId: 'gain',
        parameterName: 'Gain',
        minValue: 0,
        maxValue: 1,
        enabled: true,
        visible: true,
        collapsed: false,
        objects: [],
        points: [
            { beat: 0, value: 0.2, curve: 'linear' as const, tension: 0 },
            { beat: 4, value: 1, curve: 'linear' as const, tension: 0 },
        ],
    };
}

function seedSubjectAutomation(automated: boolean): void {
    const lanes = [lane('automated-peer')];
    if (automated) {
        lanes.push(lane('subject'));
    }
    automationStore.set({ lanes });
    settlePendingProjectWritesAndCaptureRevision();
}

function subjectWrites(automated: boolean): number[] {
    const calls = automated ? engine.scheduleTrackGain.mock.calls : engine.setTrackGain.mock.calls;
    return calls.filter(([id]) => id === 'subject').map(([, gain]) => gain);
}

function expectRuntime(automated: boolean, multiplier: number): void {
    expect(subjectWrites(automated)).toHaveLength(1);
    expect(subjectWrites(automated)[0]).toBeCloseTo((automated ? 0.6 : 0.8) * multiplier);
    const otherCalls = automated ? engine.setTrackGain.mock.calls : engine.scheduleTrackGain.mock.calls;
    expect(otherCalls.filter(([id]) => id === 'subject')).toEqual([]);
    expect(engine.scheduleTrackGain.mock.calls.every(([, , time]) => time === 10.25)).toBe(true);
    expect(
        [...engine.setTrackGain.mock.calls, ...engine.scheduleTrackGain.mock.calls].some(([id]) => id === 'unrelated')
    ).toBe(false);
}

function clearRuntime(): void {
    engine.setTrackGain.mockClear();
    engine.scheduleTrackGain.mockClear();
}

async function holdRootSnapshot(replaceRoot: boolean) {
    let release!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const held = new Promise<void>((resolve) => {
        release = resolve;
    });
    const transaction = transactSnapshot(async (snapshotTransaction) => {
        // Dirtying the root through its public mutation boundary fences outside writers.
        mutateCrdtDoc({ id: 'root', changeFn: () => {}, snapshotTransaction });
        markStarted();
        await held;
        if (replaceRoot) {
            const root = getCrdtDoc('root');
            if (!root) {
                throw new Error('Expected root before replacement');
            }
            replaceCrdtDoc({ id: 'root', doc: clone(root), snapshotTransaction });
            projectCrdtToStores();
        }
    });
    await started;
    const root = getCrdtDoc('root');
    if (!root) {
        throw new Error('Expected reserved root');
    }
    expect(() => replaceCrdtDoc({ id: 'root', doc: clone(root) })).toThrow('overlaps the active snapshot transaction');
    return { release, transaction };
}

describe('Inspector VCA gestures through production Command and committed gain', () => {
    beforeEach(async () => {
        vi.clearAllMocks();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('Inspector VCA');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        clearHandlerRegistry();
        registerHandlerMap(getArrangementHandlers());
        command.clearUndoHistory();
        command.resetActionReplayAuthority();
        clearActionHistory();
        command.setActionHistoryMetadataPort({
            record: recordActionHistoryEntry,
            markReverted: markActionHistoryEntryReverted,
            clear: clearActionHistory,
        });
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        agentProjectRepairStateStore.set(null);
        command.productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        setProjectIdentityTransitionDependencies({ leaveCollaborationSession: () => Promise.resolve() });
        const transition = runProjectLoadTransaction();
        expect(await transition.prepare()).toBe(true);
        expect(transition.activate()).toBe(true);
        const tracks = [
            testTrack('subject', 'Subject'),
            testTrack('static-peer', 'Static peer'),
            testTrack('automated-peer', 'Automated peer'),
            testTrack('unrelated', 'Unrelated'),
        ].map((track, index) => {
            let vcaGroupId = 'destination';
            if (index === 0) {
                vcaGroupId = 'old';
            } else if (index === 3) {
                vcaGroupId = 'untouched';
            }
            return {
                ...track,
                gain: index === 0 ? 0.8 : 0.4,
                muted: index === 0,
                vcaGroupId,
            };
        });
        trackStore.set({ tracks, selectedTrackId: 'subject', ghostClips: [] });
        vcaGroupStore.set({
            groups: [
                { id: 'old', name: 'Old', gain: 0.5, muted: false, trackIds: ['subject'] },
                {
                    id: 'destination',
                    name: 'Destination',
                    gain: 0.25,
                    muted: false,
                    trackIds: ['static-peer', 'automated-peer'],
                },
                { id: 'untouched', name: 'Untouched', gain: 0.75, muted: false, trackIds: ['unrelated'] },
            ],
        });
        seedSubjectAutomation(false);
        playheadPositionRef.current = 2;
        setVcaRuntimeProjectionDependencies({ reconcileVcaRuntimeGain });
        // These observations happen at the actual engine caller, after the real commit hook.
        engine.setTrackGain.mockImplementation(() => expect(rawState()).toEqual(projectedState()));
        engine.scheduleTrackGain.mockImplementation(() => expect(rawState()).toEqual(projectedState()));
    });

    afterEach(() => {
        cleanup();
        command.setActionHistoryMetadataPort(noMetadata);
        command.productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => true }));
        setVcaRuntimeProjectionDependencies(null);
        command.clearUndoHistory();
        command.resetActionReplayAuthority();
        clearActionHistory();
        clearHandlerRegistry();
        agentProjectRepairStateStore.set(null);
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        vcaGroupStore.set({ groups: [] });
        automationStore.set({ lanes: [] });
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
        vi.restoreAllMocks();
    });

    it.each([
        { kind: 'create', automated: false },
        { kind: 'assign', automated: false },
        { kind: 'none', automated: false },
        { kind: 'create', automated: true },
        { kind: 'assign', automated: true },
        { kind: 'none', automated: true },
    ] satisfies Array<{ kind: Gesture; automated: boolean }>)(
        '$kind commits one history entry and gain, automated=$automated, then restores with Undo/Redo',
        async ({ kind, automated }) => {
            seedSubjectAutomation(automated);
            const before = rawState();
            expect(before).toEqual(projectedState());
            render(<Inspector />);
            gesture(kind);
            await waitFor(() =>
                expect({ history: undoStore.value?.past.length, gains: subjectWrites(automated).length }).toEqual({
                    history: 1,
                    gains: 1,
                })
            );
            expect(actionHistoryStore.value?.entries).toHaveLength(1);
            const after = rawState();
            expect(after).toEqual(projectedState());
            let groupId: string | null | undefined = null;
            if (kind === 'create') {
                groupId = after.groups.find((group) => group.name === 'VCA 4')?.id;
            } else if (kind === 'assign') {
                groupId = 'destination';
            }
            expect(groupId).not.toBeUndefined();
            expect(after.tracks).toEqual(
                before.tracks.map((track) => (track.id === 'subject' ? { ...track, vcaGroupId: groupId } : track))
            );
            const expectedGroups = before.groups.map((group) => {
                const expectedGroup = { ...group, trackIds: group.trackIds.filter((id) => id !== 'subject') };
                if (group.id === 'destination' && kind === 'assign') {
                    expectedGroup.trackIds = [...group.trackIds, 'subject'];
                }
                return expectedGroup;
            });
            if (kind === 'create') {
                if (groupId === undefined || groupId === null) {
                    throw new Error('Expected created VCA group identity');
                }
                expectedGroups.push({ id: groupId, name: 'VCA 4', gain: 1, muted: false, trackIds: ['subject'] });
            }
            expect(after.groups).toEqual(expectedGroups);
            expect(screen.getByRole('combobox', { name: 'VCA group' })).toHaveValue(groupId ?? '');
            expectRuntime(automated, kind === 'assign' ? 0.25 : 1);
            if (kind === 'assign') {
                expect(engine.setTrackGain.mock.calls.filter(([id]) => id === 'static-peer')).toEqual([
                    ['static-peer', 0.1],
                ]);
                const peerWrites = engine.scheduleTrackGain.mock.calls.filter(([id]) => id === 'automated-peer');
                expect(peerWrites).toHaveLength(1);
                expect(peerWrites[0]?.[1]).toBeCloseTo(0.15);
            }
            clearRuntime();
            await act(() => command.undo());
            expect(rawState()).toEqual(before);
            expect(projectedState()).toEqual(before);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);
            expect(screen.getByRole('combobox', { name: 'VCA group' })).toHaveValue('old');
            expectRuntime(automated, 0.5);
            clearRuntime();
            await act(() => command.redo());
            expect(rawState()).toEqual(after);
            expect(projectedState()).toEqual(after);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
            expect(screen.getByRole('combobox', { name: 'VCA group' })).toHaveValue(groupId ?? '');
            expectRuntime(automated, kind === 'assign' ? 0.25 : 1);
        }
    );

    it.each(['create', 'assign', 'none'] as const)(
        'refuses queued %s on a same-ID successor project without state, history or engine writes',
        async (kind) => {
            render(<Inspector />);
            const identity = captureProjectIdentity();
            const { release, transaction } = await holdRootSnapshot(true);
            const dispatch = vi.spyOn(command, 'executeUserAppAction');
            gesture(kind);
            expect(dispatch).toHaveBeenCalledOnce();
            await act(async () => {
                release();
                await transaction;
                await dispatch.mock.results[0]?.value;
            });
            expect(captureProjectIdentity()).not.toBe(identity);
            expect(projectedState()).toEqual(rawState());
            expect(rawState().tracks.find((track) => track.id === 'subject')?.vcaGroupId).toBe('old');
            expect(rawState().groups.find((group) => group.id === 'old')?.trackIds).toContain('subject');
            expect(rawState().groups.find((group) => group.id === 'destination')?.trackIds).not.toContain('subject');
            expect(rawState().groups).toHaveLength(3);
            expect(undoStore.value?.past).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(engine.setTrackGain).not.toHaveBeenCalled();
            expect(engine.scheduleTrackGain).not.toHaveBeenCalled();
        }
    );

    it.each(['create', 'assign', 'none'] as const)(
        'executes queued %s after an ordinary same-project snapshot',
        async (kind) => {
            render(<Inspector />);
            const identity = captureProjectIdentity();
            const { release, transaction } = await holdRootSnapshot(false);
            const dispatch = vi.spyOn(command, 'executeUserAppAction');
            gesture(kind);
            expect(dispatch).toHaveBeenCalledOnce();
            await act(async () => {
                release();
                await transaction;
                await dispatch.mock.results[0]?.value;
            });
            expect(captureProjectIdentity()).toBe(identity);
            expect(projectedState()).toEqual(rawState());
            expect(undoStore.value?.past).toHaveLength(1);
            expect(actionHistoryStore.value?.entries).toHaveLength(1);
            expect(subjectWrites(false)).toHaveLength(1);
        }
    );

    it.each(['create', 'assign', 'none'] as const)(
        'refuses %s while the real project gate is locked without state, history or engine writes',
        async (kind) => {
            render(<Inspector />);
            const before = structuredClone(getCrdtDoc('root'));
            command.productionBriefAdmissionPort.setGuard(() => ({ allowsCurrent: () => false }));
            gesture(kind);
            await waitFor(() => expect(notifyUser).toHaveBeenCalledOnce());
            expect(notifyUser).toHaveBeenCalledWith(expect.any(String), 'warning');
            expect(getCrdtDoc('root')).toEqual(before);
            expect(projectedState()).toEqual(rawState());
            expect(undoStore.value?.past).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(engine.setTrackGain).not.toHaveBeenCalled();
            expect(engine.scheduleTrackGain).not.toHaveBeenCalled();
        }
    );

    it.each(['assigned', 'unassigned'] as const)(
        'keeps an already %s subject unchanged on a no-op selection',
        async (membership) => {
            if (membership === 'unassigned') {
                const tracks = trackStore.value;
                const vca = vcaGroupStore.value;
                if (!tracks || !vca) {
                    throw new Error('Expected seeded stores');
                }
                trackStore.set({
                    ...tracks,
                    tracks: tracks.tracks.map((track) =>
                        track.id === 'subject' ? { ...track, vcaGroupId: null } : track
                    ),
                });
                vcaGroupStore.set({
                    groups: vca.groups.map((group) => ({
                        ...group,
                        trackIds: group.trackIds.filter((id) => id !== 'subject'),
                    })),
                });
                settlePendingProjectWritesAndCaptureRevision();
            }
            render(<Inspector />);
            const before = structuredClone(getCrdtDoc('root'));
            // Observe the real entry promise so a no-write command has a completion witness.
            const dispatch = vi.spyOn(command, 'executeUserAppAction');
            await act(async () => {
                fireEvent.change(screen.getByRole('combobox', { name: 'VCA group' }), {
                    target: { value: membership === 'assigned' ? 'old' : '' },
                });
                expect(dispatch).toHaveBeenCalledOnce();
                await dispatch.mock.results[0]?.value;
            });
            expect(getCrdtDoc('root')).toEqual(before);
            expect(projectedState()).toEqual(rawState());
            expect(undoStore.value?.past).toEqual([]);
            expect(actionHistoryStore.value?.entries).toEqual([]);
            expect(engine.setTrackGain).not.toHaveBeenCalled();
            expect(engine.scheduleTrackGain).not.toHaveBeenCalled();
            expect(notifyUser).not.toHaveBeenCalled();
        }
    );
});
