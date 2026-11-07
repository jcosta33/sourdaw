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

type Scope = { id: string; active: boolean; sequence: Sequence | null };

export function useTrackMuteToggle(trackId: string, muted: boolean): () => Promise<void> {
    const current = useRef<Scope | null>(null);
    if (!current.current || current.current.id !== trackId) {
        current.current = { id: trackId, active: true, sequence: null };
    }
    const scope = current.current;
    useEffect(() => {
        scope.active = true;
        return () => {
            scope.active = false;
        };
    }, [scope]);

    return () => {
        let sequence = scope.sequence;
        if (!sequence) {
            sequence = {
                identity: captureProjectIdentity(),
                expected: muted,
                tail: null,
                valid: true,
                committed: false,
            };
            scope.sequence = sequence;
        }
        const owned = sequence;
        const live = () => scope.active && current.current === scope && captureProjectIdentity() === owned.identity;
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
            if (owned.tail === run && scope.sequence === owned) {
                scope.sequence = null;
            }
        });
    };
}
