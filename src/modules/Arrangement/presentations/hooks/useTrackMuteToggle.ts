import { useEffect, useRef } from 'react';

import { executeUserAppAction } from '#/modules/Command/useCases';
import { captureProjectIdentity } from '#/modules/CrdtDocument/useCases';

import { getTrackStoreState } from '../../useCases/getTrackStoreState';

type Sequence = {
    identity: string;
    expected: boolean;
    tail: Promise<void> | null;
    valid: boolean;
    committed: boolean;
};

type Scope = { id: string };
type ScopedSequence = { scope: Scope; sequence: Sequence };

export function useTrackMuteToggle(trackId: string, muted: boolean): () => Promise<void> {
    const scopeRef = useRef<Scope | null>(null);
    const sequenceRef = useRef<ScopedSequence | null>(null);
    useEffect(() => {
        const scope: Scope = { id: trackId };
        scopeRef.current = scope;
        return () => {
            if (scopeRef.current === scope) {
                scopeRef.current = null;
            }
        };
    }, [trackId]);

    return () => {
        const scope = scopeRef.current;
        if (!scope || scope.id !== trackId) {
            return Promise.resolve();
        }
        const identity = captureProjectIdentity();
        let sequence =
            sequenceRef.current?.scope === scope && sequenceRef.current.sequence.identity === identity
                ? sequenceRef.current.sequence
                : null;
        if (!sequence) {
            sequence = {
                identity,
                expected: muted,
                tail: null,
                valid: true,
                committed: false,
            };
            sequenceRef.current = { scope, sequence };
        }
        const owned = sequence;
        const live = () => scopeRef.current === scope && captureProjectIdentity() === owned.identity;
        const execute = async () => {
            if (!owned.valid || !live()) {
                return;
            }
            const expected = owned.expected;
            if (
                owned.committed &&
                getTrackStoreState()?.tracks.find((track) => track.id === trackId)?.muted !== expected
            ) {
                owned.valid = false;
                return;
            }
            let committed = false;
            await executeUserAppAction(
                { type: 'muteTrack', payload: { trackId, muted: !expected, expectedMuted: expected } },
                {
                    skipUndo: true,
                    shouldExecute: live,
                    shouldCommit: live,
                    onCommitted: () => {
                        committed = true;
                    },
                }
            );
            if (!committed || !live()) {
                owned.valid = false;
                return;
            }
            owned.committed = true;
            owned.expected = !expected;
        };
        const run = owned.tail ? owned.tail.then(execute) : execute();
        owned.tail = run;
        return run.finally(() => {
            if (owned.tail === run && sequenceRef.current?.sequence === owned) {
                sequenceRef.current = null;
            }
        });
    };
}
