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
 * One tail the native host reported, with its place in the order the host took
 * every figure in. The host numbers the `plugin-tail-changed` events and the
 * `read_plugin_tails` answers from one counter, inside the instance's control
 * gate, so a larger sequence is the figure read later however late either was
 * delivered.
 */
export type NativeTailFigure = {
    tailSamples: number;
    sequence: number;
};

/**
 * Which seed or drop last touched each instance's tail. Each takes the next
 * value of one counter, and a drop keeps its own rather than resetting, so a
 * stamp issued before an instance was dropped never matches one a later seed
 * of the same id takes. This orders only what a native sequence cannot: a read
 * issued before a seed or a drop belongs to an earlier instance, or to the
 * load's own figure, and loses. A published figure never advances it.
 */
const tailStamps = new Map<string, number>();
let lastTailStamp = 0;

function advanceTailStamp(instanceId: string): void {
    lastTailStamp += 1;
    tailStamps.set(instanceId, lastTailStamp);
}

/**
 * The highest native sequence applied to each seeded instance. A figure at or
 * below it is older than what the store shows and is ignored. A seed clears it,
 * so every native figure outranks the load's own.
 */
const appliedSequences = new Map<string, number>();

/** How many issued reads have yet to settle, per instance; a stamp is kept while any has. */
const readsInFlight = new Map<string, number>();

/** Ended by a graph rebuild, so reads issued before one are not for this generation's instances. */
let tailGeneration = 0;

/** What a read remembers about one instance from the moment it was issued. */
export type ExternalPluginTailReadIssue = {
    /** The instance's write stamp when the read was issued. */
    writeStamp: number | undefined;
    generation: number;
};

/** Each instance's write stamp as it stands now, for a read about to be issued. Settle it when the read ends. */
export function issueExternalPluginTailRead(
    instanceIds: readonly string[]
): ReadonlyMap<string, ExternalPluginTailReadIssue> {
    for (const instanceId of instanceIds) {
        readsInFlight.set(instanceId, (readsInFlight.get(instanceId) ?? 0) + 1);
    }
    return new Map(
        instanceIds.map((instanceId) => [
            instanceId,
            { writeStamp: tailStamps.get(instanceId), generation: tailGeneration },
        ])
    );
}

/** End a read issued by `issueExternalPluginTailRead`, whether it answered or failed. */
export function settleExternalPluginTailRead(issued: ReadonlyMap<string, ExternalPluginTailReadIssue>): void {
    for (const [instanceId, issue] of issued) {
        if (issue.generation !== tailGeneration) {
            continue;
        }
        const remaining = (readsInFlight.get(instanceId) ?? 1) - 1;
        if (remaining > 0) {
            readsInFlight.set(instanceId, remaining);
            continue;
        }
        readsInFlight.delete(instanceId);
        pruneForgottenInstance(instanceId);
    }
}

/** Nothing for a forgotten instance is worth keeping once no read can compare against it. */
function pruneForgottenInstance(instanceId: string): void {
    if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] !== undefined) {
        return;
    }
    if (readsInFlight.has(instanceId)) {
        return;
    }
    tailStamps.delete(instanceId);
    appliedSequences.delete(instanceId);
}

/**
 * What became of a read's answer for one instance. `unseeded` means the answer
 * is current but its instance's load has not seeded a figure yet, so the caller
 * decides whether to hold it for the seed.
 */
export type ExternalPluginTailReadOutcome = 'applied' | 'stale' | 'unseeded';

/**
 * Publish a tail a host read answered. It is stale when a seed, a drop (so also
 * an unload and reload under the same id) or a graph rebuild touched that
 * instance since the read was issued, or when a figure with a sequence at or
 * above its own already landed, which is how an event the host emitted later
 * than the read ran outranks it, and an event it emitted earlier does not.
 */
export function publishExternalPluginTailRead(
    instanceId: string,
    issue: ExternalPluginTailReadIssue,
    figure: NativeTailFigure
): ExternalPluginTailReadOutcome {
    if (issue.generation !== tailGeneration || tailStamps.get(instanceId) !== issue.writeStamp) {
        return 'stale';
    }
    if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] === undefined) {
        return 'unseeded';
    }
    return applyNativeTailFigure(instanceId, figure) ? 'applied' : 'stale';
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

/** Set a seeded instance's tail unless a figure at or after this one already landed. */
function applyNativeTailFigure(instanceId: string, { tailSamples, sequence }: NativeTailFigure): boolean {
    if (sequence <= (appliedSequences.get(instanceId) ?? 0)) {
        return false;
    }
    appliedSequences.set(instanceId, sequence);
    setExternalPluginTail(instanceId, tailSamples);
    return true;
}

/**
 * Seed an instance's tail from its load. Every native figure outranks it, and
 * every read issued before it drops.
 */
export function writeExternalPluginTail(instanceId: string, tailSamples: number): void {
    advanceTailStamp(instanceId);
    appliedSequences.delete(instanceId);
    setExternalPluginTail(instanceId, tailSamples);
}

/**
 * Revise the tail of an instance whose load already seeded it, for a
 * `plugin-tail-changed` event. A change for an instance with no entry is
 * dropped: recording it would describe a plugin that no longer exists. The
 * caller holds a change for an instance still loading and hands it to the
 * load's seed instead. An event the host emitted before a figure already
 * applied is ignored, by sequence.
 */
export function reviseExternalPluginTail(instanceId: string, figure: NativeTailFigure): void {
    if (externalPluginTailStore.value?.tailSamplesByInstanceId[instanceId] === undefined) {
        return;
    }
    applyNativeTailFigure(instanceId, figure);
}

export function dropExternalPluginTail(instanceId: string): void {
    advanceTailStamp(instanceId);
    appliedSequences.delete(instanceId);
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
    pruneForgottenInstance(instanceId);
}

/** End the graph generation: every tail, stamp and sequence goes, and reads still in flight drop their answers. */
export function resetExternalPluginTails(): void {
    tailGeneration += 1;
    tailStamps.clear();
    appliedSequences.clear();
    readsInFlight.clear();
    externalPluginTailStore.set(defaultExternalPluginTailState);
}

/** How many instances the store still keeps a stamp or a sequence for; a spec reads it to prove forgetting prunes. */
export function countExternalPluginTailBookkeeping(): number {
    return new Set([...tailStamps.keys(), ...appliedSequences.keys()]).size;
}
