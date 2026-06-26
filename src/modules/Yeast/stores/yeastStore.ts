/**
 * Yeast store — tracks the MIDI rack state for UI rendering.
 *
 * Write operations have moved to useCases/:
 *   addYeastProcessor, removeYeastProcessor, reorderYeastProcessor,
 *   setYeastProcessorBypass, setYeastProcessorParam, setYeastUiLevel
 *
 * This store holds:
 *   - the reactive yeastStore instance (public contract surface)
 *   - singleton rack/worklet runtime state
 *   - read access helpers (getYeastRack, getYeastWorkletNodeAsync)
 *   - internal sync and registration helpers used by the use cases
 */

import { eventBus } from '#/app/registerDependencies';
import { logger } from '#/infra/logger/appLogger';
import { createStore } from '#/infra/store/createStore';
import { createHmrPersistentState } from '#/utils/HMR/createHmrPersistentState';

import { createYeastWorkletNode, type YeastWorkletNodeResult } from '../engine/YeastWorkletNode';
import { MidiRack } from '../useCases/MidiRack';
import { type ProcessorType } from '../useCases/processorFactory';

/**
 * The processor-kind discriminant carried by the store's reactive state.
 *
 * `ProcessorType` is defined in `useCases/processorFactory`, where use-case
 * types are otherwise private (AGENTS.md). It surfaces here — and through
 * `YeastState` on the store's public barrel — *intentionally*: the set of
 * processor kinds is reactive domain state the UI renders and filters on
 * (`YeastPanel` switches on `processor.type`), not a use-case implementation
 * detail. Re-exporting it under the store's own name makes that boundary
 * crossing explicit and named for external consumers, instead of leaking the
 * raw use-case type transitively through `YeastState.processors[].type`.
 *
 * The alias keeps a single source of truth: it is the same union the factory
 * produces, so values flow across the boundary without a cast or widening.
 */
export type YeastProcessorType = ProcessorType;

export type YeastProcessorInfo = {
    id: string;
    type: YeastProcessorType;
    name: string;
    bypassed: boolean;
};

export type YeastState = {
    processors: YeastProcessorInfo[];
    uiLevel: 1 | 2 | 3 | 4 | 5;
};

const defaultState: YeastState = {
    processors: [],
    uiLevel: 1,
};

export const yeastStore = createStore<YeastState>({ initialData: defaultState });

/**
 * A worklet mutation issued before the worklet node finished initializing.
 *
 * `addProcessor`/`removeProcessor` are replayed from `processorTypeMap`, but
 * `setParam`/`setBypass` leave no trace in that map — they are applied directly
 * to processor instances. Buffering them here lets `getYeastWorkletNodeAsync`
 * replay them (in issue order, after the add-replay) so the worklet rack matches
 * the main-thread rack on resolve.
 *
 * `reorder` is deliberately NOT buffered: a raw (fromIdx, toIdx) recorded
 * against the rack's index at issue time diverges if a reorder and a
 * removeProcessor interleave during init (the indices shift under it). Instead
 * the resolve handler reconciles the worklet chain to the rack's authoritative
 * processor-id order in one pass — the rack already applied every reorder and
 * remove synchronously, so its id order is the single source of truth.
 */
type PendingWorkletOp =
    | { kind: 'setParam'; id: string; name: string; value: number }
    | { kind: 'setBypass'; id: string; bypassed: boolean };

type YeastSessionState = {
    rackInstance: MidiRack | null;
    processorTypeMap: Map<string, ProcessorType>;
    pendingWorkletOps: PendingWorkletOp[];
    _workletNode: YeastWorkletNodeResult | null;
    _workletNodePromise: Promise<YeastWorkletNodeResult | null> | null;
    // The AudioContext the in-flight `_workletNodePromise` is being constructed
    // against. A resolved node carries its own `.context`, but an in-flight
    // creation does not — without recording the target ctx here, a context swap
    // during the `addModule`+construct window cannot tell that the pending
    // promise is bound to the old, now-stale context.
    _workletNodeCtx: BaseAudioContext | null;
};

const session = createHmrPersistentState<YeastSessionState>('yeast.session', () => ({
    rackInstance: null,
    processorTypeMap: new Map<string, ProcessorType>(),
    pendingWorkletOps: [],
    _workletNode: null,
    _workletNodePromise: null,
    _workletNodeCtx: null,
}));

/**
 * Lazily create (or return cached) the YeastWorkletNode.
 * Returns null if the worklet fails to initialize (triggers main-thread fallback).
 */
export async function getYeastWorkletNodeAsync(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult | null> {
    // If the context changed, invalidate the existing session — both a resolved
    // node and a creation still in flight. The resolved node carries its own
    // `.context`; an in-flight promise is matched against the recorded
    // `_workletNodeCtx` it was started with. Without invalidating the in-flight
    // case, a ctx swap during the `addModule`+construct window would return a
    // promise bound to the old context, and its node would be used against the
    // wrong `BaseAudioContext`.
    const resolvedCtxStale = session._workletNode !== null && session._workletNode.context !== ctx;
    const pendingCtxStale =
        session._workletNode === null && session._workletNodePromise !== null && session._workletNodeCtx !== ctx;
    if (resolvedCtxStale || pendingCtxStale) {
        session._workletNode = null;
        session._workletNodePromise = null;
        session._workletNodeCtx = null;
        session.pendingWorkletOps = [];
    }

    if (session._workletNode) {
        return session._workletNode;
    }
    if (session._workletNodePromise) {
        return session._workletNodePromise;
    }

    session._workletNodeCtx = ctx;
    session._workletNodePromise = createYeastWorkletNode(ctx)
        .then((node) => {
            // The context may have swapped while this node was being constructed.
            // If the session has since moved on to a different ctx (a newer
            // creation was started, or it was invalidated), this node is bound to
            // the stale context — discard it instead of clobbering the session,
            // so the caller falls back to the main-thread rack for this block and
            // the next call constructs against the live context.
            if (session._workletNodeCtx !== ctx) {
                node.destroy();
                return null;
            }
            session._workletNode = node;
            // Route the worklet rack's hung-note offs (from a mid-playback
            // removeProcessor) to the live instrument via the same app event the
            // main-thread use case emits, so the AudioEngine has a single sink.
            // Without this the worklet posts the offs back but nothing forwards
            // them and the note hangs.
            node.onNotesOff((notes) => {
                if (notes.length > 0) {
                    void eventBus.emit('yeast.notesOff', { notes });
                }
            });
            // Sync any processors that were added before the worklet was ready.
            for (const [id, type] of session.processorTypeMap) {
                node.addProcessor(type, id);
            }
            // Reconcile the worklet chain order to the rack's authoritative
            // processor-id order. The add-replay above appended processors in
            // `processorTypeMap` insertion order, which can differ from the rack's
            // order after any reorder/remove issued during init. Reorder by id —
            // not by buffered raw indices, which diverge when a reorder and a
            // remove interleave (each shifts the indices under the other).
            reconcileWorkletOrder(node, getYeastRack().getProcessorIds(), [...session.processorTypeMap.keys()]);
            // Replay param/bypass mutations issued during init — these are not
            // recoverable from processorTypeMap, so without this they are silently
            // lost on the worklet rack (the add-replay above only restores
            // processor identity, not their tweaked state).
            for (const op of session.pendingWorkletOps) {
                switch (op.kind) {
                    case 'setParam':
                        node.setParam(op.id, op.name, op.value);
                        break;
                    case 'setBypass':
                        node.setBypass(op.id, op.bypassed);
                        break;
                }
            }
            session.pendingWorkletOps = [];
            return node;
        })
        .catch((error) => {
            logger.warn('[Yeast] Worklet init failed, using main-thread fallback:', error);
            session._workletNodePromise = null;
            // Drop buffered ops: the main-thread rack already applied them and
            // is now the source of truth. Keeping them would misapply stale
            // mutations onto a later worklet that lacks those processors.
            session.pendingWorkletOps = [];
            return null;
        });

    return session._workletNodePromise;
}

/**
 * Reorder the worklet chain to match `targetOrder` (the rack's authoritative
 * processor-id order), given the worklet's current id order after the
 * add-replay. Issues a selection-sort sequence of `reorder(from, to)` index
 * moves — the same op the worklet protocol already supports — tracking a local
 * mirror of the chain so each move's indices stay correct. Ids present in
 * `currentOrder` but absent from `targetOrder` (or vice versa) are skipped; in
 * practice both lists hold the same id set, since the add-replay adds exactly
 * the registered processors.
 */
function reconcileWorkletOrder(
    node: YeastWorkletNodeResult,
    targetOrder: readonly string[],
    currentOrder: readonly string[]
): void {
    const working = currentOrder.filter((id) => targetOrder.includes(id));
    const target = targetOrder.filter((id) => working.includes(id));
    for (let toIdx = 0; toIdx < target.length; toIdx++) {
        const wantId = target[toIdx]!;
        if (working[toIdx] === wantId) {
            continue;
        }
        const fromIdx = working.indexOf(wantId, toIdx);
        if (fromIdx === -1) {
            continue;
        }
        node.reorder(fromIdx, toIdx);
        // Mirror the move locally: splice out at fromIdx, insert at toIdx, so
        // subsequent moves compute against the chain's real post-move order.
        const [moved] = working.splice(fromIdx, 1);
        working.splice(toIdx, 0, moved!);
    }
}

export function getYeastRack(): MidiRack {
    if (!session.rackInstance) {
        session.rackInstance = new MidiRack();
    }
    return session.rackInstance;
}

/**
 * Recorder returned by `getWorkletNodeSync` while the real worklet node is
 * still initializing. It buffers the mutations that the resolve-time replay
 * cannot reconstruct from `processorTypeMap` (param/bypass) so they are not
 * lost; no-ops add/remove (replayed from the type map), `reorder` (the resolve
 * handler reconciles chain order from the rack's authoritative id order), and
 * `processBlock` (only ever driven through `getYeastWorkletNodeAsync`).
 */
function createPendingWorkletRecorder(): YeastWorkletNodeResult {
    return {
        get context(): never {
            throw new Error('YeastWorkletNode not ready: context is unavailable until the worklet resolves');
        },
        processBlock: () =>
            Promise.reject(new Error('YeastWorkletNode not ready: use getYeastWorkletNodeAsync for processBlock')),
        addProcessor: () => {
            /* replayed from processorTypeMap on resolve */
        },
        removeProcessor: () => {
            /* replayed from processorTypeMap on resolve */
        },
        reorder: () => {
            /* not buffered: the resolve handler reconciles the worklet chain to
               the rack's authoritative id order in one pass, which already
               reflects every reorder applied to the rack during init */
        },
        setParam: (id, name, value) => {
            session.pendingWorkletOps.push({ kind: 'setParam', id, name, value });
        },
        setBypass: (id, bypassed) => {
            session.pendingWorkletOps.push({ kind: 'setBypass', id, bypassed });
        },
        allNotesOff: () => {
            /* transient panic state; nothing to replay on resolve */
        },
        onNotesOff: () => () => {
            /* no real node yet; removeProcessor on the recorder is a no-op
               (replayed from processorTypeMap), so it emits no hung-note offs */
        },
        destroy: () => {
            /* no real node to tear down */
        },
    };
}

/**
 * Synchronous access to the worklet node for notifying it of mutations without
 * awaiting. Once the worklet has resolved, returns the live node. While it is
 * still initializing (a node creation is in flight), returns a recorder that
 * buffers param/bypass/reorder mutations for replay on resolve, so writes
 * applied during init reach the worklet rack instead of being dropped. Returns
 * null only when no worklet has been requested or init has failed (the
 * main-thread rack is then the sole source of truth).
 */
export function getWorkletNodeSync(): YeastWorkletNodeResult | null {
    if (session._workletNode) {
        return session._workletNode;
    }
    if (session._workletNodePromise) {
        return createPendingWorkletRecorder();
    }
    return null;
}

/**
 * Register a processor type mapping for a given processor ID.
 * Called by write use cases when adding a processor.
 */
export function registerProcessorType(id: string, type: ProcessorType): void {
    session.processorTypeMap.set(id, type);
}

/**
 * Remove a processor type mapping.
 * Called by write use cases when removing a processor.
 */
export function unregisterProcessorType(id: string): void {
    session.processorTypeMap.delete(id);
}

/**
 * Sync the reactive store from the current rack state.
 * Called by write use cases after any mutation to the rack.
 */
export function syncStoreFromRack(): void {
    const rack = getYeastRack();
    const state = yeastStore.value;
    if (!state) {
        return;
    }

    const names = rack.getProcessorNames();
    yeastStore.set({
        ...state,
        processors: names.map((node) => ({
            id: node.id,
            type: session.processorTypeMap.get(node.id) ?? inferType(node.name),
            name: node.name,
            bypassed: node.bypassed,
        })),
    });
}

function inferType(name: string): ProcessorType {
    if (name.includes('Arp')) {
        return 'arpeggiator';
    }
    if (name.includes('Chord')) {
        return 'chord';
    }
    if (name.includes('Scale')) {
        return 'scale';
    }
    if (name.includes('Repeat')) {
        return 'repeater';
    }
    if (name.includes('Veloc')) {
        return 'velocity';
    }
    if (name.includes('Human')) {
        return 'humanizer';
    }
    if (name.includes('Filter')) {
        return 'filter';
    }
    if (name.includes('Trans')) {
        return 'transposer';
    }
    return 'arpeggiator';
}
