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
 * `setParam`/`setBypass`/`reorder` leave no trace in that map — they are
 * applied directly to processor instances or to chain order. Buffering them
 * here lets `getYeastWorkletNodeAsync` replay them (in issue order, after the
 * add-replay) so the worklet rack matches the main-thread rack on resolve.
 */
type PendingWorkletOp =
    | { kind: 'setParam'; id: string; name: string; value: number }
    | { kind: 'setBypass'; id: string; bypassed: boolean }
    | { kind: 'reorder'; fromIdx: number; toIdx: number };

type YeastSessionState = {
    rackInstance: MidiRack | null;
    processorTypeMap: Map<string, ProcessorType>;
    pendingWorkletOps: PendingWorkletOp[];
    _workletNode: YeastWorkletNodeResult | null;
    _workletNodePromise: Promise<YeastWorkletNodeResult | null> | null;
};

const session = createHmrPersistentState<YeastSessionState>('yeast.session', () => ({
    rackInstance: null,
    processorTypeMap: new Map<string, ProcessorType>(),
    pendingWorkletOps: [],
    _workletNode: null,
    _workletNodePromise: null,
}));

/**
 * Lazily create (or return cached) the YeastWorkletNode.
 * Returns null if the worklet fails to initialize (triggers main-thread fallback).
 */
export async function getYeastWorkletNodeAsync(ctx: BaseAudioContext): Promise<YeastWorkletNodeResult | null> {
    // If context changed, invalidate existing session
    if (session._workletNode && session._workletNode.context !== ctx) {
        session._workletNode = null;
        session._workletNodePromise = null;
    }

    if (session._workletNode) {
        return session._workletNode;
    }
    if (session._workletNodePromise) {
        return session._workletNodePromise;
    }

    session._workletNodePromise = createYeastWorkletNode(ctx)
        .then((node) => {
            session._workletNode = node;
            // Sync any processors that were added before the worklet was ready.
            for (const [id, type] of session.processorTypeMap) {
                node.addProcessor(type, id);
            }
            // Replay param/bypass/reorder mutations issued during init — these
            // are not recoverable from processorTypeMap, so without this they
            // are silently lost on the worklet rack (the add-replay above only
            // restores processor identity, not their tweaked state or order).
            for (const op of session.pendingWorkletOps) {
                switch (op.kind) {
                    case 'setParam':
                        node.setParam(op.id, op.name, op.value);
                        break;
                    case 'setBypass':
                        node.setBypass(op.id, op.bypassed);
                        break;
                    case 'reorder':
                        node.reorder(op.fromIdx, op.toIdx);
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

export function getYeastRack(): MidiRack {
    if (!session.rackInstance) {
        session.rackInstance = new MidiRack();
    }
    return session.rackInstance;
}

/**
 * Recorder returned by `getWorkletNodeSync` while the real worklet node is
 * still initializing. It buffers the mutations that the resolve-time replay
 * cannot reconstruct from `processorTypeMap` (param/bypass/reorder) so they
 * are not lost, and no-ops add/remove (replayed from the type map) and
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
        reorder: (fromIdx, toIdx) => {
            session.pendingWorkletOps.push({ kind: 'reorder', fromIdx, toIdx });
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
