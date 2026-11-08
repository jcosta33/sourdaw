import { executeAppActionBatch } from '#/modules/Command/useCases';
import { captureProjectRootIdentity } from '#/modules/CrdtDocument/useCases';
import { captureRecordedControllerRetirement } from '#/modules/MIDI/useCases';
import { transportStore } from '#/modules/Transport/stores';
import { notifyUser } from '#/utils/Notification/notifyUser';
import { valuesEqual } from '#/utils/structuralEquality';

import { activeRecordingRef } from '../../stores/activeRecordingRef';
import { trackStore, type Clip } from '../../stores/trackStore';

import { readRecordingClipOwner } from './readRecordingClipOwner';
import { recordingMidiBound } from './recordingMidiBound';

type Action = { type: 'commitRecording'; payload: { clip: Clip } };
type Prepared = { action: Action; shouldExecute?: () => boolean; before: string };
type Slot = {
    group: Group;
    clipId: string;
    trackId: string;
    objectId: string | undefined;
    prepared: Prepared | null;
    retired: boolean;
    retireControllers: ReturnType<typeof captureRecordedControllerRetirement> | null;
    completion: PromiseWithResolvers<void>;
};
type Group = { root: string; id: string; slots: Slot[]; publishing: boolean };
const current = new Map<string, Slot>();
let activeGroup: Group | null = null;

export class RecordingCommitOwnershipRefusal extends Error {
    constructor() {
        super('Recording changed while its sibling captures were finishing');
        this.name = 'RecordingCommitOwnershipRefusal';
    }
}

export class RecordingRootMovedRefusal extends Error {
    constructor(message = 'Recording commit was refused by its execution guard') {
        super(message);
        this.name = 'RecordingRootMovedRefusal';
    }
}

function rawClip(clipId: string) {
    return readRecordingClipOwner(clipId)?.clip;
}

function clipObjectId(clipId: string): string | undefined {
    return readRecordingClipOwner(clipId)?.incarnation;
}

function liveClip(clipId: string): Clip | undefined {
    return trackStore.value?.tracks.flatMap((track) => track.clips).find((clip) => clip.id === clipId);
}

function detach(slot: Slot): void {
    if (current.get(slot.clipId) === slot) {
        current.delete(slot.clipId);
    }
}

function refuse(slot: Slot, error: Error): void {
    slot.retired = true;
    detach(slot);
    slot.completion.reject(error);
}

function warnCommitted(status: 'ambiguous' | 'committed-with-warning'): void {
    notifyUser(
        status === 'ambiguous'
            ? 'Recording was kept, but its save or history could not be verified. Keep the project open and check it before continuing.'
            : 'Recording was kept, but some finishing work failed. Check the project before closing.',
        'warning'
    );
}

async function publish(group: Group): Promise<void> {
    const active = group.slots.filter((slot) => !slot.retired);
    try {
        if (captureProjectRootIdentity() !== group.root) {
            throw new RecordingRootMovedRefusal();
        }
        const valid: Slot[] = [];
        for (const slot of active) {
            if (
                !slot.objectId ||
                clipObjectId(slot.clipId) !== slot.objectId ||
                JSON.stringify(liveClip(slot.clipId) ?? null) !== slot.prepared?.before
            ) {
                refuse(slot, new RecordingCommitOwnershipRefusal());
            } else {
                valid.push(slot);
            }
        }
        if (valid.length === 0) {
            return;
        }
        let sourceChanged = false;
        const result = await executeAppActionBatch(
            valid.map((slot) => slot.prepared!.action),
            {
                groupId: group.id,
                groupLabel: 'Record tracks',
                authorizeFirstHandler: () => {
                    sourceChanged = valid.some(
                        (slot) => JSON.stringify(liveClip(slot.clipId) ?? null) !== slot.prepared!.before
                    );
                    return sourceChanged ? 'Recording changed while its sibling captures were finishing' : null;
                },
                shouldExecute: () => {
                    if (captureProjectRootIdentity() !== group.root) {
                        throw new RecordingRootMovedRefusal();
                    }
                    return valid.every(
                        (slot) =>
                            clipObjectId(slot.clipId) === slot.objectId && slot.prepared!.shouldExecute?.() !== false
                    );
                },
            }
        );
        if (result.status === 'ambiguous' || result.status === 'committed-with-warning') {
            warnCommitted(result.status);
        } else if (result.status !== 'committed') {
            if (captureProjectRootIdentity() !== group.root) {
                throw new RecordingRootMovedRefusal();
            }
            if (sourceChanged) {
                throw new RecordingCommitOwnershipRefusal();
            }
            throw new Error(
                `Recording group ${result.status}: ${'reason' in result ? result.reason : 'no publication'}`
            );
        }
        for (const slot of valid) {
            slot.completion.resolve();
        }
    } catch (error) {
        for (const slot of active) {
            slot.completion.reject(error);
        }
    } finally {
        for (const slot of group.slots) {
            detach(slot);
        }
    }
}

function reconcile(group: Group): void {
    if (captureProjectRootIdentity() !== group.root) {
        for (const slot of group.slots) {
            refuse(slot, new RecordingRootMovedRefusal());
        }
        return;
    }
    for (const slot of group.slots) {
        if (slot.retired || clipObjectId(slot.clipId) === slot.objectId) {
            continue;
        }
        if (!clipObjectId(slot.clipId) && !liveClip(slot.clipId)) {
            slot.retireControllers?.();
            slot.retired = true;
            detach(slot);
            slot.completion.resolve();
        } else {
            refuse(slot, new RecordingCommitOwnershipRefusal());
        }
    }
    if (activeGroup === group && group.slots.every((slot) => slot.retired)) {
        recordingMidiBound.retire();
    }
}

function settle(group: Group): void {
    if (!group.publishing) {
        reconcile(group);
    }
    if (group.publishing || group.slots.some((slot) => !slot.retired && !slot.prepared)) {
        return;
    }
    group.publishing = true;
    void publish(group);
}

/** Only newly admitted automatic clips participate; existing overdub rows never do. */
function beginRecordingCommitGroup(clips: readonly Clip[]): void {
    if (clips.length === 0) {
        activeGroup = null;
        return;
    }
    const group: Group = {
        root: captureProjectRootIdentity(),
        id: `recording-${crypto.randomUUID()}`,
        slots: [],
        publishing: false,
    };
    activeGroup = group;
    for (const clip of clips) {
        const previous = current.get(clip.id);
        if (previous) {
            retireSlot(previous);
        }
        const slot: Slot = {
            group,
            clipId: clip.id,
            trackId: clip.trackId,
            objectId: clipObjectId(clip.id),
            prepared: null,
            retired: false,
            retireControllers: null,
            completion: Promise.withResolvers<void>(),
        };
        // A slot may retire before a terminal ever submits a commit.
        void slot.completion.promise.catch(() => undefined);
        group.slots.push(slot);
        current.set(clip.id, slot);
    }
}

function retireSlot(slot: Slot): void {
    if (slot.retired || slot.group.publishing) {
        return;
    }
    slot.retireControllers?.();
    slot.retired = true;
    detach(slot);
    slot.completion.resolve();
    settle(slot.group);
}

function captureControllerRetirement(clipId: string) {
    if (liveClip(clipId)?.type === 'midi') {
        return captureRecordedControllerRetirement(clipId, true);
    }
    return Object.assign(() => {}, { owns: () => true });
}

/** The admitted group already owns its one controller retirement capability. */
function hasRecordingCommitGroup(clipId: string): boolean {
    return current.has(clipId);
}

/** Capture the slot incarnation before IO; a stale result cannot retire a replacement. */
function captureRecordingCommitRetirement(clipId: string): () => void {
    const slot = current.get(clipId);
    if (slot && !slot.retireControllers) {
        slot.retireControllers = captureControllerRetirement(clipId);
    }
    return () => {
        if (slot) {
            retireSlot(slot);
        }
    };
}

function settleActiveRecordingCommitGroup(root: string | null): void {
    const group = activeGroup;
    if (group?.root === root) {
        activeGroup = null;
        settle(group);
    }
}

function refuseRecordingCommitGroups(clipIds: readonly string[], root: string | null): void {
    for (const clipId of clipIds) {
        const group = current.get(clipId)?.group;
        if (group?.root === root) {
            for (const slot of group.slots) {
                refuse(slot, new RecordingRootMovedRefusal());
            }
        }
    }
}

/** Return a captured submit capability, or the ordinary single-clip publication path. */
function captureRecordingCommitSubmission(clipId: string) {
    const slot = current.get(clipId);
    if (!slot) {
        return null;
    }
    slot.retireControllers ??= captureControllerRetirement(clipId);
    const before = JSON.stringify(liveClip(clipId) ?? null);
    return (action: Action, shouldExecute?: () => boolean): Promise<void> => {
        if (slot.retired) {
            return slot.completion.promise;
        }
        slot.prepared = { action, shouldExecute, before };
        settle(slot.group);
        return slot.completion.promise;
    };
}

/** Repair only this live gesture's refs after a removal transaction restored its original rows. */
function reconcileRecordingAdmission(clipId?: string, trackId?: string | null): boolean {
    const group = activeGroup;
    if (
        !group ||
        group.publishing ||
        captureProjectRootIdentity() !== group.root ||
        activeRecordingRef.capturedRootIdentity !== group.root ||
        transportStore.value?.isRecording !== true
    ) {
        return true;
    }
    const owns = (slot: Slot): boolean =>
        !slot.retired &&
        current.get(slot.clipId) === slot &&
        !!slot.objectId &&
        clipObjectId(slot.clipId) === slot.objectId &&
        liveClip(slot.clipId)?.trackId === slot.trackId &&
        slot.retireControllers?.owns() !== false;
    for (const slot of group.slots) {
        if (
            !slot.prepared &&
            owns(slot) &&
            !activeRecordingRef.current.includes(slot.clipId) &&
            valuesEqual(liveClip(slot.clipId), rawClip(slot.clipId))
        ) {
            activeRecordingRef.current = [...activeRecordingRef.current, slot.clipId];
        }
    }
    const targets = group.slots.filter((slot) => {
        if (clipId) {
            return slot.clipId === clipId;
        }
        if (trackId) {
            return slot.trackId === trackId;
        }
        return false;
    });
    return (
        targets.length === 0 || targets.some((slot) => owns(slot) && activeRecordingRef.current.includes(slot.clipId))
    );
}

export const recordingCommitGroups = {
    begin: beginRecordingCommitGroup,
    has: hasRecordingCommitGroup,
    captureRetirement: captureRecordingCommitRetirement,
    settleActive: settleActiveRecordingCommitGroup,
    refuse: refuseRecordingCommitGroups,
    captureSubmission: captureRecordingCommitSubmission,
    reconcileAdmission: reconcileRecordingAdmission,
};
