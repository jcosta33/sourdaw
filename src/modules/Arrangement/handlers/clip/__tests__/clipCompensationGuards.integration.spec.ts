import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Container } from '#/infra/di/Container';
import { createEventBus } from '#/infra/events/createEventBus';
import {
    configureAutomergeStoragePort,
    flushAutomergeStorageWrites,
} from '#/infra/store/storage/createAutomergeStorage';
import { trackStore } from '#/modules/Arrangement/stores';
import { getArrangementHandlers } from '#/modules/Arrangement/useCases';
import { clearHandlerRegistry, macroStore, registerHandlerMap, undoStore } from '#/modules/Command/stores';
import {
    clearUndoHistory,
    executeAppAction,
    executeAppActionBatch,
    getMacroHandlers,
    redo,
    resetActionReplayAuthority,
    setActionHistoryMetadataPort,
    undo,
} from '#/modules/Command/useCases';
import {
    createCrdtDoc,
    registerCrdtStorageRuntime,
    removeCrdtDoc,
    resetCrdtProjectAuthority,
} from '#/modules/CrdtDocument/useCases';
import { defaultTransportState, transportStore } from '#/modules/Transport/stores';
import { type AppAction } from '#/utils/handlerContract';
import {
    type ConfirmPayload,
    type NotifyPayload,
    type PromptPayload,
    setNotificationEventBus,
} from '#/utils/Notification/notificationEventBus';

import { ClipDummy } from '../../../__tests__/ClipDummy';
import { TrackDummy } from '../../../__tests__/TrackDummy';
import { type Clip } from '../../../models/Track';
import { updateClip } from '../../../repositories/track/updateClip';
import { lockClip } from '../../../useCases/clipEditing/lockClip';
import { muteClip } from '../../../useCases/clipEditing/muteClip';
import { nudgeClip } from '../../../useCases/clipEditing/nudgeClip';
import { renameClip } from '../../../useCases/clipEditing/renameClip';
import { setClipColor } from '../../../useCases/clipEditing/setClipColor';
import { setClipFade } from '../../../useCases/clipEditing/setClipFade';
import { slipClipContent } from '../../../useCases/clipEditing/slipClipContent';
import { trimClipEnd } from '../../../useCases/clipEditing/trimClipEnd';
import { trimClipStart } from '../../../useCases/clipEditing/trimClipStart';

const noActionHistoryMetadataPort = {
    record: () => [],
    markReverted: () => ({ status: 'unavailable' as const }),
    clear: () => undefined,
};

type NotificationEvents = {
    'ui.notify': NotifyPayload;
    'ui.confirm': ConfirmPayload;
    'ui.prompt': PromptPayload;
};

type GuardCase = {
    type: AppAction['type'];
    seed: Partial<Clip>;
    action: AppAction;
    /** The value the action writes, read back from the live clip. */
    read: (clip: Clip) => unknown;
    before: unknown;
    after: unknown;
    /** A foreign write of the same field, after the action committed. */
    foreignWrite: () => void;
    foreign: unknown;
    /** A foreign write made while the action is undone, when `foreignWrite` would leave the undone state as it is. */
    foreignWriteWhileUndone?: () => void;
    /** The expected-state keys the action's recorded inverse carries. */
    expectedKeys: string[];
    /** A value with two states: a peer's write of the other state equals the value undo or redo would write. */
    twoState?: true;
};

const cases: GuardCase[] = [
    {
        type: 'renameClip',
        seed: { name: 'Original' },
        action: { type: 'renameClip', payload: { clipId: 'clip-1', name: 'Renamed' } },
        read: (clip) => clip.name,
        before: 'Original',
        after: 'Renamed',
        foreignWrite: () => renameClip('clip-1', 'Foreign'),
        foreign: 'Foreign',
        expectedKeys: ['expectedName'],
    },
    {
        type: 'trimClipEnd',
        seed: { startBeat: 0, endBeat: 8 },
        action: { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 6 } },
        read: (clip) => clip.endBeat,
        before: 8,
        after: 6,
        foreignWrite: () => trimClipEnd('clip-1', 5),
        foreign: 5,
        expectedKeys: ['expectedEndBeat'],
    },
    {
        type: 'trimClipStart',
        // A trim always stores both offsets, so the exact-state comparison starts from clips that hold them.
        seed: { type: 'midi', startBeat: 0, endBeat: 8, audioOffsetBeats: 0, midiOffsetBeats: 0 },
        action: { type: 'trimClipStart', payload: { clipId: 'clip-1', newStartBeat: 2 } },
        read: (clip) => clip.startBeat,
        before: 0,
        after: 2,
        foreignWrite: () => trimClipStart('clip-1', 1),
        foreign: 1,
        expectedKeys: ['expectedStartBeat'],
    },
    {
        type: 'nudgeClip',
        seed: { startBeat: 0, endBeat: 8 },
        action: { type: 'nudgeClip', payload: { clipId: 'clip-1', beats: 2 } },
        read: (clip) => clip.startBeat,
        before: 0,
        after: 2,
        foreignWrite: () => nudgeClip('clip-1', 1),
        foreign: 3,
        expectedKeys: ['expectedStartBeat', 'expectedPlacement'],
    },
    {
        type: 'slipClipContent',
        seed: { type: 'midi', startBeat: 0, endBeat: 8, midiOffsetBeats: 0 },
        action: { type: 'slipClipContent', payload: { clipId: 'clip-1', clipType: 'midi', offset: 1 } },
        read: (clip) => clip.midiOffsetBeats,
        before: 0,
        after: 1,
        foreignWrite: () => slipClipContent('clip-1', 'midi', 3),
        foreign: 3,
        expectedKeys: ['expectedOffset'],
    },
    {
        type: 'muteClip',
        seed: { muted: false },
        action: { type: 'muteClip', payload: { clipId: 'clip-1', muted: true } },
        read: (clip) => clip.muted,
        before: false,
        after: true,
        foreignWrite: () => muteClip('clip-1', false),
        foreignWriteWhileUndone: () => muteClip('clip-1', true),
        foreign: false,
        expectedKeys: ['expectedMuted'],
        twoState: true,
    },
    {
        type: 'setClipColor',
        seed: { color: '#ff0000' },
        action: { type: 'setClipColor', payload: { clipId: 'clip-1', color: '#00ff00' } },
        read: (clip) => clip.color,
        before: '#ff0000',
        after: '#00ff00',
        foreignWrite: () => setClipColor('clip-1', '#0000ff'),
        foreign: '#0000ff',
        expectedKeys: ['expectedColor'],
    },
    {
        type: 'setClipFade',
        seed: { fadeInBeats: 0, fadeOutBeats: 0 },
        action: { type: 'setClipFade', payload: { clipId: 'clip-1', fadeInBeats: 1, fadeOutBeats: 2 } },
        read: (clip) => ({ in: clip.fadeInBeats, out: clip.fadeOutBeats }),
        before: { in: 0, out: 0 },
        after: { in: 1, out: 2 },
        foreignWrite: () => setClipFade('clip-1', 3, 3),
        foreign: { in: 3, out: 3 },
        expectedKeys: ['expectedFadeInBeats', 'expectedFadeOutBeats'],
    },
    {
        type: 'lockClip',
        seed: { locked: false },
        action: { type: 'lockClip', payload: { clipId: 'clip-1', locked: true } },
        read: (clip) => clip.locked,
        before: false,
        after: true,
        foreignWrite: () => lockClip('clip-1', false),
        foreignWriteWhileUndone: () => lockClip('clip-1', true),
        foreign: false,
        expectedKeys: ['expectedLocked'],
        twoState: true,
    },
];

const compensationRefusal = (type: string) => `Action compensation is not guarded inside an atomic batch: ${type}`;

let notifications: NotifyPayload[] = [];
let unsubscribeFromNotifications: () => void = () => undefined;

function currentClip(): Clip {
    const clip = trackStore.value?.tracks[0]?.clips[0];
    if (!clip) {
        throw new Error('Expected clip fixture');
    }
    return clip;
}

function seedClip(overrides: Partial<Clip>): void {
    const clip = ClipDummy.create({ id: 'clip-1', trackId: 'track-1', ...overrides });
    const track = TrackDummy.create({ id: 'track-1', clips: [clip] });
    trackStore.set({ tracks: [track], selectedTrackId: track.id, ghostClips: [] });
    flushAutomergeStorageWrites();
}

function registerHandlers(describeOverride?: { type: AppAction['type']; strip: string[] }): void {
    clearHandlerRegistry();
    const handlers = getArrangementHandlers();
    if (!describeOverride) {
        registerHandlerMap(handlers);
    } else {
        const original = handlers[describeOverride.type as keyof typeof handlers] as {
            describe: (action: AppAction, context?: unknown) => { inverseAction?: AppAction | null };
        };
        const unguarded = {
            ...original,
            describe: (action: AppAction, context?: unknown) => {
                const description = original.describe(action, context);
                const inverse = description.inverseAction;
                if (!inverse) {
                    return description;
                }
                if (inverse.payload === undefined) {
                    throw new Error('Expected the recorded inverse to carry a payload');
                }
                const payload = Object.fromEntries(
                    Object.entries(inverse.payload).filter(([key]) => !describeOverride.strip.includes(key))
                );
                return { ...description, inverseAction: { ...inverse, payload } };
            },
        };
        registerHandlerMap({ ...handlers, [describeOverride.type]: unguarded });
    }
    registerHandlerMap(getMacroHandlers());
}

describe('clip edit compensation guards', () => {
    beforeEach(() => {
        Container.clear();
        configureAutomergeStoragePort(null);
        resetCrdtProjectAuthority('clip compensation guards integration');
        removeCrdtDoc('root');
        createCrdtDoc('root');
        registerCrdtStorageRuntime();
        const notificationEventBus = createEventBus<NotificationEvents>();
        notifications = [];
        unsubscribeFromNotifications = notificationEventBus.on('ui.notify', (notification) => {
            notifications.push(notification);
        });
        setNotificationEventBus(notificationEventBus);
        clearUndoHistory();
        resetActionReplayAuthority();
        setActionHistoryMetadataPort(noActionHistoryMetadataPort);
        macroStore.set({ macros: [], recording: false, currentRecording: [] });
        transportStore.set({ ...defaultTransportState, isPlaying: false, isRecording: false });
    });

    afterEach(() => {
        clearUndoHistory();
        resetActionReplayAuthority();
        clearHandlerRegistry();
        unsubscribeFromNotifications();
        Container.clear();
        trackStore.set({ tracks: [], selectedTrackId: null, ghostClips: [] });
        transportStore.set(defaultTransportState);
        configureAutomergeStoragePort(null);
        removeCrdtDoc('root');
    });

    describe.each(cases)('$type', (guard) => {
        it('commits in an atomic compensated batch and undo restores the exact prior clip', async () => {
            registerHandlers();
            seedClip(guard.seed);
            const prior = structuredClone(currentClip());

            const result = await executeAppActionBatch([guard.action], { source: 'prompt', requireCompensation: true });

            expect(result.status).toBe('committed');
            expect(guard.read(currentClip())).toEqual(guard.after);

            await undo();
            expect(currentClip()).toEqual(prior);
            expect(guard.read(currentClip())).toEqual(guard.before);
        });

        it('redoes the new value after an undo', async () => {
            registerHandlers();
            seedClip(guard.seed);
            await executeAppActionBatch([guard.action], { source: 'prompt', requireCompensation: true });
            await undo();

            await redo();

            expect(guard.read(currentClip())).toEqual(guard.after);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
        });

        it('stays refused when the recorded inverse carries no expected state', async () => {
            registerHandlers({ type: guard.type, strip: guard.expectedKeys });
            seedClip(guard.seed);
            const prior = structuredClone(currentClip());

            const result = await executeAppActionBatch([guard.action], { source: 'prompt', requireCompensation: true });

            expect(result).toMatchObject({ status: 'rejected', reason: compensationRefusal(guard.type) });
            expect(currentClip()).toEqual(prior);
        });
    });

    describe.each(cases.filter((guard) => guard.twoState !== true))('$type', (guard) => {
        it('refuses the undo and keeps a foreign edit of the same field', async () => {
            registerHandlers();
            seedClip(guard.seed);
            await executeAppActionBatch([guard.action], { source: 'prompt', requireCompensation: true });
            guard.foreignWrite();
            expect(guard.read(currentClip())).toEqual(guard.foreign);
            const notificationsBefore = notifications.length;

            await undo();

            expect(guard.read(currentClip())).toEqual(guard.foreign);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
            expect(notifications.slice(notificationsBefore)).toEqual([
                expect.objectContaining({ level: 'warning', message: expect.stringContaining('Cannot undo') }),
            ]);
        });

        it('refuses the redo and keeps a foreign edit made while undone', async () => {
            registerHandlers();
            seedClip(guard.seed);
            await executeAppActionBatch([guard.action], { source: 'prompt', requireCompensation: true });
            await undo();
            (guard.foreignWriteWhileUndone ?? guard.foreignWrite)();
            const diverged = structuredClone(currentClip());
            const notificationsBefore = notifications.length;

            await redo();

            expect(currentClip()).toEqual(diverged);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);
            expect(notifications.slice(notificationsBefore)).toEqual([
                expect.objectContaining({ level: 'warning', message: expect.stringContaining('Cannot redo') }),
            ]);
        });
    });

    describe('each side of a fade guards its own undo and redo', () => {
        const fadeSeed = { fadeInBeats: 0, fadeOutBeats: 0 };
        const fade: AppAction = {
            type: 'setClipFade',
            payload: { clipId: 'clip-1', fadeInBeats: 1, fadeOutBeats: 2 },
        };
        const sides = [
            {
                side: 'fade-in',
                whileDone: () => setClipFade('clip-1', 3, 2),
                whileUndone: () => setClipFade('clip-1', 3, 0),
            },
            {
                side: 'fade-out',
                whileDone: () => setClipFade('clip-1', 1, 3),
                whileUndone: () => setClipFade('clip-1', 0, 3),
            },
        ];

        it.each(sides)('refuses the undo after a divergent $side edit alone', async ({ whileDone }) => {
            registerHandlers();
            seedClip(fadeSeed);
            await executeAppActionBatch([fade], { source: 'prompt', requireCompensation: true });
            whileDone();
            const diverged = structuredClone(currentClip());

            await undo();

            expect(currentClip()).toEqual(diverged);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
        });

        it.each(sides)('refuses the redo after a divergent $side edit alone while undone', async ({ whileUndone }) => {
            registerHandlers();
            seedClip(fadeSeed);
            await executeAppActionBatch([fade], { source: 'prompt', requireCompensation: true });
            await undo();
            whileUndone();
            const diverged = structuredClone(currentClip());

            await redo();

            expect(currentClip()).toEqual(diverged);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);
        });
    });

    describe('a recorded slip carries its own guard before anything runs', () => {
        const slipExpecting = (expectedOffset: number): AppAction => ({
            type: 'slipClipContent',
            payload: { clipId: 'clip-1', clipType: 'midi', offset: 2, expectedOffset },
        });

        async function runWithAuthorizationCount(
            action: AppAction
        ): Promise<{ status: string; authorizations: number }> {
            registerHandlers();
            seedClip({ type: 'midi', startBeat: 0, endBeat: 8, audioOffsetBeats: 0, midiOffsetBeats: 0 });
            let authorizations = 0;
            const result = await executeAppActionBatch([action], {
                source: 'prompt',
                authorizeFirstHandler: () => {
                    authorizations += 1;
                    return null;
                },
            });
            return { status: result.status, authorizations };
        }

        it('refuses a stale expected offset at validation, before the first handler is authorized to execute', async () => {
            const held = await runWithAuthorizationCount(slipExpecting(0));
            const stale = await runWithAuthorizationCount(slipExpecting(5));

            expect(held).toEqual({ status: 'committed', authorizations: 1 });
            expect(stale).toEqual({ status: 'conflicted', authorizations: 0 });
        });
    });

    describe('a nudge restores its start bit-for-bit', () => {
        it.each([
            { start: 0.0371, beats: 0.25 },
            { start: 0.1, beats: 0.2 },
            { start: 3.3, beats: -1.1 },
            { start: 1 / 3, beats: 0.7 },
            { start: 2.675, beats: 0.005 },
            { start: 0.0371, beats: -0.5 },
        ])(
            'nudge $beats from $start: undo and redo never conflict and every step is exact',
            async ({ start, beats }) => {
                registerHandlers();
                const duration = 4.1;
                seedClip({
                    startBeat: start,
                    endBeat: start + duration,
                    loopOriginBeat: start - 0.0123,
                    audioLoopPassOriginBeat: start + 0.0456,
                });
                const prior = structuredClone(currentClip());

                const result = await executeAppActionBatch(
                    [{ type: 'nudgeClip', payload: { clipId: 'clip-1', beats } }],
                    {
                        source: 'prompt',
                        requireCompensation: true,
                    }
                );
                expect(result.status).toBe('committed');
                const nudged = structuredClone(currentClip());

                for (let round = 0; round < 3; round += 1) {
                    await undo();
                    expect(currentClip()).toEqual(prior);
                    await redo();
                    expect(currentClip()).toEqual(nudged);
                }
                expect(notifications).toEqual([]);
            }
        );
    });

    describe('a nudge guards the whole placement its undo and redo expect', () => {
        const seed: Partial<Clip> = {
            startBeat: 4,
            endBeat: 8,
            loopOriginBeat: 3.5,
            audioLoopPassOriginBeat: 4.25,
        };
        const nudgeBatch: AppAction[] = [{ type: 'nudgeClip', payload: { clipId: 'clip-1', beats: 2 } }];
        const peerEdits: { name: string; edit: () => void }[] = [
            { name: 'a trim of the end', edit: () => trimClipEnd('clip-1', 12) },
            {
                name: 'a loop origin change alone',
                edit: () => updateClip('clip-1', (clip) => ({ ...clip, loopOriginBeat: 1 })),
            },
            {
                name: 'an audio loop pass origin change alone',
                edit: () => updateClip('clip-1', (clip) => ({ ...clip, audioLoopPassOriginBeat: 1 })),
            },
        ];

        it.each(peerEdits)('refuses the undo and keeps $name by a peer', async ({ edit }) => {
            registerHandlers();
            seedClip(seed);
            await executeAppActionBatch(nudgeBatch, { source: 'prompt', requireCompensation: true });
            edit();
            const diverged = structuredClone(currentClip());
            const notificationsBefore = notifications.length;

            await undo();

            expect(currentClip()).toEqual(diverged);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(0);
            expect(notifications.slice(notificationsBefore)).toEqual([
                expect.objectContaining({ level: 'warning', message: expect.stringContaining('Cannot undo') }),
            ]);
        });

        it.each(peerEdits)('refuses the redo and keeps $name made while undone', async ({ edit }) => {
            registerHandlers();
            seedClip(seed);
            await executeAppActionBatch(nudgeBatch, { source: 'prompt', requireCompensation: true });
            await undo();
            edit();
            const diverged = structuredClone(currentClip());
            const notificationsBefore = notifications.length;

            await redo();

            expect(currentClip()).toEqual(diverged);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(1);
            expect(notifications.slice(notificationsBefore)).toEqual([
                expect.objectContaining({ level: 'warning', message: expect.stringContaining('Cannot redo') }),
            ]);
        });

        it('undoes and redoes cleanly when a clip with no anchors is untouched by peers', async () => {
            registerHandlers();
            seedClip({ startBeat: 4, endBeat: 8 });
            const prior = structuredClone(currentClip());

            await executeAppActionBatch(nudgeBatch, { source: 'prompt', requireCompensation: true });
            const nudged = structuredClone(currentClip());
            await undo();
            expect(currentClip()).toEqual(prior);
            await redo();

            expect(currentClip()).toEqual(nudged);
            expect(notifications).toEqual([]);
        });

        it('refuses the undo when a peer adds an anchor the nudged clip did not carry', async () => {
            registerHandlers();
            seedClip({ startBeat: 4, endBeat: 8 });
            await executeAppActionBatch(nudgeBatch, { source: 'prompt', requireCompensation: true });
            updateClip('clip-1', (clip) => ({ ...clip, loopOriginBeat: 5 }));
            const diverged = structuredClone(currentClip());

            await undo();

            expect(currentClip()).toEqual(diverged);
            expect(undoStore.value?.past).toHaveLength(1);
        });
    });

    describe('a clip edited more than once in one batch', () => {
        const midiSeed: Partial<Clip> = {
            type: 'midi',
            startBeat: 0,
            endBeat: 8,
            audioOffsetBeats: 0,
            midiOffsetBeats: 0,
        };
        const nudge = (beats: number): AppAction => ({ type: 'nudgeClip', payload: { clipId: 'clip-1', beats } });
        const trimStart = (newStartBeat: number): AppAction => ({
            type: 'trimClipStart',
            payload: { clipId: 'clip-1', newStartBeat },
        });
        const slip = (offset: number): AppAction => ({
            type: 'slipClipContent',
            payload: { clipId: 'clip-1', clipType: 'midi', offset },
        });

        it.each([
            { name: 'a nudge then a trim of the start', actions: [nudge(2), trimStart(3)], start: 3, offset: 1 },
            { name: 'two trims of the start', actions: [trimStart(2), trimStart(4)], start: 4, offset: 4 },
            { name: 'a trim of the start then a slip', actions: [trimStart(2), slip(1)], start: 2, offset: 1 },
        ])('undoes $name back to the exact prior clip', async ({ actions, start, offset }) => {
            registerHandlers();
            seedClip(midiSeed);
            const prior = structuredClone(currentClip());

            const result = await executeAppActionBatch(actions, {
                source: 'prompt',
                requireCompensation: true,
                groupId: 'clip-sequence',
                groupLabel: 'Edit one clip twice',
            });

            expect(result.status).toBe('committed');
            expect(currentClip()).toMatchObject({ startBeat: start, midiOffsetBeats: offset });

            await undo();

            expect(notifications).toEqual([]);
            expect(currentClip()).toEqual(prior);
            expect(undoStore.value?.past).toHaveLength(0);
            expect(undoStore.value?.future).toHaveLength(actions.length);

            await redo();

            expect(notifications).toEqual([]);
            expect(currentClip()).toMatchObject({ startBeat: start, midiOffsetBeats: offset });
            expect(undoStore.value?.future).toHaveLength(0);
        });

        it('plans a nudge of a locked clip as no movement for the guard that follows it in the batch', async () => {
            registerHandlers();
            seedClip({ startBeat: 4, endBeat: 8, locked: true });
            const prior = structuredClone(currentClip());
            const handler = getArrangementHandlers().nudgeClip;
            const context = { actions: [nudge(2), nudge(1)], actionIndex: 1 };
            const realPlacement = { startBeat: 4, endBeat: 8 };

            const description = handler.describe(
                { type: 'nudgeClip', payload: { clipId: 'clip-1', beats: 1 } },
                context
            );

            // The first nudge leaves the locked clip where it is, so the second plans against the real start.
            expect(description.inverseAction).toEqual({
                type: 'nudgeClip',
                payload: { clipId: 'clip-1', beats: 0, expectedPlacement: realPlacement, placement: realPlacement },
            });
            expect(description.redoAction).toEqual({
                type: 'nudgeClip',
                payload: { clipId: 'clip-1', beats: 1, expectedPlacement: realPlacement, placement: realPlacement },
            });
            const guarded: AppAction = {
                type: 'nudgeClip',
                payload: { clipId: 'clip-1', beats: 1, expectedPlacement: realPlacement },
            };
            expect(handler.validate?.(guarded, context)).toBe(true);

            const result = await executeAppActionBatch([nudge(2), nudge(1)], {
                source: 'prompt',
                requireCompensation: true,
            });

            expect(result.status).toBe('conflicted');
            expect(currentClip()).toEqual(prior);
            expect(undoStore.value?.past).toHaveLength(0);
        });

        it('rejects a guarded edit planned after an audio trim of the same clip', async () => {
            registerHandlers();
            seedClip({ startBeat: 0, endBeat: 8 });
            const prior = structuredClone(currentClip());

            const alone = await executeAppActionBatch([trimStart(2)], { source: 'prompt', requireCompensation: true });
            expect(alone.status).toBe('committed');
            await undo();
            expect(currentClip()).toEqual(prior);

            const result = await executeAppActionBatch([trimStart(2), nudge(1)], {
                source: 'prompt',
                requireCompensation: true,
            });

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Action is not compensable inside an atomic batch: nudgeClip',
            });
            expect(currentClip()).toEqual(prior);
        });

        it.each([
            {
                name: 'an audio trim of the start',
                action: trimStart(2),
                reason: 'Action is not compensable inside an atomic batch: trimClipStart',
            },
            {
                name: 'an audio slip',
                action: {
                    type: 'slipClipContent',
                    payload: { clipId: 'clip-1', clipType: 'audio', offset: 1 },
                } satisfies AppAction,
                reason: 'Action is not compensable inside an atomic batch: slipClipContent',
            },
        ])('rejects $name planned after an earlier edit of the same audio clip', async ({ action, reason }) => {
            registerHandlers();
            seedClip({ startBeat: 0, endBeat: 8 });
            const prior = structuredClone(currentClip());

            // The audio capture reads the clip as the store holds it, so it is stale after a nudge in the batch.
            const alone = await executeAppActionBatch([action], { source: 'prompt', requireCompensation: true });
            expect(alone.status).toBe('committed');
            await undo();
            expect(currentClip()).toEqual(prior);

            const result = await executeAppActionBatch([nudge(1), action], {
                source: 'prompt',
                requireCompensation: true,
            });

            expect(result).toMatchObject({ status: 'rejected', reason });
            expect(currentClip()).toEqual(prior);
        });

        it('rejects a guarded edit planned after an earlier action split the clip', async () => {
            registerHandlers();
            seedClip({ startBeat: 0, endBeat: 8 });
            const priorTracks = structuredClone(trackStore.value?.tracks);

            const result = await executeAppActionBatch(
                [
                    { type: 'splitClip', payload: { clipId: 'clip-1', beat: 4 } },
                    { type: 'trimClipEnd', payload: { clipId: 'clip-1', newEndBeat: 3 } },
                ],
                { source: 'prompt', requireCompensation: true }
            );

            expect(result).toMatchObject({
                status: 'rejected',
                reason: 'Action is not compensable inside an atomic batch: trimClipEnd',
            });
            expect(trackStore.value?.tracks).toEqual(priorTracks);
        });
    });
    describe.each([
        {
            name: 'muteClip',
            seed: { muted: false },
            action: { type: 'muteClip', payload: { clipId: 'clip-1', muted: true } } satisfies AppAction,
            peerRevert: () => muteClip('clip-1', false),
            prior: (clip: Clip) => clip.muted,
            before: false,
        },
        {
            name: 'lockClip',
            seed: { locked: false },
            action: { type: 'lockClip', payload: { clipId: 'clip-1', locked: true } } satisfies AppAction,
            peerRevert: () => lockClip('clip-1', false),
            prior: (clip: Clip) => clip.locked,
            before: false,
        },
        {
            name: 'renameClip',
            seed: {},
            action: { type: 'renameClip', payload: { clipId: 'clip-1', name: 'Renamed' } } satisfies AppAction,
            peerRevert: () => renameClip('clip-1', 'Second'),
            prior: (clip: Clip) => clip.name,
            before: 'Second',
        },
    ])('$name after a peer already restored the value', ({ seed, action, peerRevert, prior, before }) => {
        it('consumes the entry on undo so the earlier edit is reachable', async () => {
            registerHandlers();
            seedClip({ name: 'First', ...seed });
            await executeAppAction({ type: 'renameClip', payload: { clipId: 'clip-1', name: 'Second' } }, { source: 'prompt' });
            await executeAppAction(action, { source: 'prompt' });
            peerRevert();
            expect(prior(currentClip())).toEqual(before);

            await undo();

            expect(notifications).toEqual([]);
            expect(undoStore.value?.past).toHaveLength(1);
            expect(undoStore.value?.future).toHaveLength(1);

            await undo();

            expect(currentClip().name).toBe('First');
            expect(undoStore.value?.past).toHaveLength(0);
        });
    });
});
