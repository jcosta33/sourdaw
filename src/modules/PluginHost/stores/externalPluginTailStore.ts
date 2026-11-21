import { createStore } from '#/infra/store/createStore';

/**
 * How long each loaded external plugin instance keeps sounding after its input
 * stops — a reverb's decay, a delay's repeats — as the plugin last reported it.
 *
 * Runtime state, not project truth: the figure is the plugin's own answer about
 * the instance this process loaded, and it is gone with the instance. The load
 * seeds it, `plugin-tail-changed` revises it, and unload or a graph rebuild
 * drops it.
 *
 * Frames of the rate the instance was activated with, never seconds: both plugin
 * formats reserve the top of the range for a tail that never ends, and a
 * converted sentinel would read as an ordinary duration. A reader converts, and
 * decides what an unending tail means for it.
 */
export type ExternalPluginTailState = {
    tailSamplesByInstanceId: Record<string, number>;
};

export const defaultExternalPluginTailState: ExternalPluginTailState = {
    tailSamplesByInstanceId: {},
};

export const externalPluginTailStore = createStore<ExternalPluginTailState>({
    initialData: defaultExternalPluginTailState,
});

/**
 * Writers are module-private: they are not on the `stores/` barrel, so foreign
 * modules read this store and never write it.
 */

/**
 * Which write last touched each instance's tail. A seed, a `plugin-tail-changed`
 * revision and a drop each take the next value of one counter, and a drop keeps
 * its own rather than resetting, so a stamp issued before an instance was
 * dropped never matches one a later seed of the same id takes. A published host
 * read is not a write in this sense: it never advances the stamp, so one
 * answer cannot invalidate another read issued at the same stamp.
 */
const tailStamps = new Map<string, number>();
let lastTailStamp = 0;

function advanceTailStamp(instanceId: string): void {
    lastTailStamp += 1;
    tailStamps.set(instanceId, lastTailStamp);
}

/**
 * Which host read last published each instance's tail, by issue token. Reads
 * take tokens from one counter in the order they are issued, so a larger token
 * is a later read.
 */
const publishedReadTokens = new Map<string, number>();
let lastReadToken = 0;

/** What a read remembers about one instance from the moment it was issued. */
export type ExternalPluginTailReadIssue = {
    /** The instance's write stamp when the read was issued. */
    writeStamp: number | undefined;
    /** The read's place in issue order, shared by every instance it covers. */
    token: number;
};

/** Each instance's write stamp as it stands now, with this read's issue token, for a read about to be issued. */
export function issueExternalPluginTailRead(
    instanceIds: readonly string[]
): ReadonlyMap<string, ExternalPluginTailReadIssue> {
    lastReadToken += 1;
    const token = lastReadToken;
    return new Map(instanceIds.map((instanceId) => [instanceId, { writeStamp: tailStamps.get(instanceId), token }]));
}

/**
 * Publish a tail a host read answered. The answer is dropped when a write
 * (seed, `plugin-tail-changed` revision, drop, so also an unload and reload
 * under the same id) touched that instance's tail since the read was issued, or
 * when a read issued later already published for it. Otherwise it lands, and
 * records its token without advancing the write stamp, so reads that overlap at
 * one stamp are ordered by issue, not by which answers first.
 */
export function publishExternalPluginTailRead(
    instanceId: string,
    issue: ExternalPluginTailReadIssue,
    tailSamples: number
): void {
    if (tailStamps.get(instanceId) !== issue.writeStamp) {
        return;
    }
    if ((publishedReadTokens.get(instanceId) ?? 0) > issue.token) {
        return;
    }
    if (!setExistingExternalPluginTail(instanceId, tailSamples)) {
        return;
    }
    publishedReadTokens.set(instanceId, issue.token);
}

function setExternalPluginTail(instanceId: string, tailSamples: number): void {
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        return {
            ...current,
            tailSamplesByInstanceId: { ...current.tailSamplesByInstanceId, [instanceId]: tailSamples },
        };
    });
}

/** Set the tail of an instance that already has one; false when it has none. */
function setExistingExternalPluginTail(instanceId: string, tailSamples: number): boolean {
    if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] === undefined) {
        return false;
    }
    setExternalPluginTail(instanceId, tailSamples);
    return true;
}

export function writeExternalPluginTail(instanceId: string, tailSamples: number): void {
    advanceTailStamp(instanceId);
    publishedReadTokens.delete(instanceId);
    setExternalPluginTail(instanceId, tailSamples);
}

/**
 * Revise the tail of an instance whose load already seeded it, for a
 * `plugin-tail-changed` event. A change for an instance with no entry is
 * dropped: recording it would describe a plugin that no longer exists. The
 * caller holds a change for an instance still loading and hands it to the
 * load's seed instead. A revision advances the write stamp, so every read
 * issued before it drops.
 */
export function reviseExternalPluginTail(instanceId: string, tailSamples: number): void {
    if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] === undefined) {
        return;
    }
    advanceTailStamp(instanceId);
    publishedReadTokens.delete(instanceId);
    setExternalPluginTail(instanceId, tailSamples);
}

export function dropExternalPluginTail(instanceId: string): void {
    advanceTailStamp(instanceId);
    publishedReadTokens.delete(instanceId);
    externalPluginTailStore.update((state) => {
        const current = state ?? defaultExternalPluginTailState;
        if (current.tailSamplesByInstanceId[instanceId] === undefined) {
            return current;
        }
        const tailSamplesByInstanceId = Object.fromEntries(
            Object.entries(current.tailSamplesByInstanceId).filter(([id]) => id !== instanceId)
        );
        return { ...current, tailSamplesByInstanceId };
    });
}
