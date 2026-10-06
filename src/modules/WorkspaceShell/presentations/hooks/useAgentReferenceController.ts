import { useState } from 'react';

import { useStore } from '#/infra/store/useStore';
import { agentReferenceStore } from '#/modules/AiRuntime/stores';
import { clearAgentReference, loadAgentReference } from '#/modules/AiRuntime/useCases';

type AgentReferenceState = NonNullable<typeof agentReferenceStore.value>;
type LoadResult = Awaited<ReturnType<typeof loadAgentReference>>;
type LoadFailure = Extract<LoadResult, { status: 'failed' }>['reason'];
type LoadState = { phase: 'idle' } | { phase: 'loading' } | { phase: 'failed'; reason: LoadFailure };

/** Stable identity: `useSyncExternalStore` re-renders forever on a fresh default per read. */
const EMPTY_REFERENCE_STATE: AgentReferenceState = { reference: null, loadEpoch: 0 };

const LOAD_FAILURE_TEXT: Readonly<Record<LoadFailure, string>> = {
    'file-unavailable': 'The file could not be opened. Choose it again.',
    'file-too-large': 'That file is too large to use as a reference.',
    'undecodable-audio': 'That file could not be decoded as audio.',
    'empty-audio': 'That file holds no audio.',
    'too-long': 'That file is too long to use as a reference.',
    'measurement-failed': 'That file was decoded but could not be measured.',
};

function formatLoudness(measurements: NonNullable<AgentReferenceState['reference']>['measurements']): string {
    const entry = measurements.integratedLoudness;
    if (entry?.status !== 'measured' || typeof entry.value !== 'number') {
        return 'loudness unavailable';
    }
    return `${entry.value.toFixed(1)} ${entry.unit}`;
}

/**
 * The reference surface of the agent workspace: the loaded reference as the user reads it, whether
 * a file is being measured, why the last file left no reference, and the two controls that load
 * and clear it. The measuring and the store belong to AiRuntime; this keeps only the load outcome.
 */
export function useAgentReferenceController() {
    const { reference } = useStore(agentReferenceStore, EMPTY_REFERENCE_STATE);
    const [loadState, setLoadState] = useState<LoadState>({ phase: 'idle' });

    const handleLoad = (): void => {
        setLoadState({ phase: 'loading' });
        loadAgentReference()
            .then((result) => {
                setLoadState(
                    result.status === 'failed' ? { phase: 'failed', reason: result.reason } : { phase: 'idle' }
                );
                return null;
            })
            .catch(() => {
                setLoadState({ phase: 'failed', reason: 'measurement-failed' });
            });
    };

    const handleClear = (): void => {
        clearAgentReference();
        setLoadState({ phase: 'idle' });
    };

    return {
        reference:
            reference === null ? null : { name: reference.name, loudness: formatLoudness(reference.measurements) },
        loading: loadState.phase === 'loading',
        error: loadState.phase === 'failed' ? LOAD_FAILURE_TEXT[loadState.reason] : null,
        handleLoad,
        handleClear,
    };
}
