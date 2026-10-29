import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { Button } from '#/components/ui/button';
import { useStore } from '#/infra/store/useStore';
import { agentMeasurementArtifactStore } from '#/modules/AudioRendering/stores';
import { captureProjectRevision, subscribeToCrdtChanges } from '#/modules/CrdtDocument/useCases';

import { agentRunStore } from '../../stores/agentRunStore';
import { measuredPreviewAuditionStore } from '../../stores/measuredPreviewAuditionStore';
import { pendingActionConfirmationStore } from '../../stores/pendingActionConfirmationStore';
import { getMeasuredPreviewAuditionView } from '../../useCases/getMeasuredPreviewAuditionView';
import { startMeasuredPreviewAudition } from '../../useCases/startMeasuredPreviewAudition';
import { stopMeasuredPreviewAudition } from '../../useCases/stopMeasuredPreviewAudition';

type AuditionProps = { confirmationId: string; selectedIntentGroupIds: readonly string[] };

function useAuditionControls(input: AuditionProps) {
    // The projection reads canonical owners. These subscriptions invalidate it
    // on their actual publications, including expiry and bulk project changes.
    useStore(pendingActionConfirmationStore);
    useStore(agentRunStore);
    useStore(agentMeasurementArtifactStore);
    useStore(measuredPreviewAuditionStore);
    useSyncExternalStore(subscribeToCrdtChanges, captureProjectRevision);
    const view = getMeasuredPreviewAuditionView(input);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [notice, setNotice] = useState<string | null>(null);
    const attempt = useRef(0);
    const selected = view.targets.find((target) => target.targetId === selectedId) ?? view.targets[0];
    const available = selected?.available === true && view.phase !== 'restore-failed';

    useEffect(
        () => () => {
            attempt.current++;
            void stopMeasuredPreviewAudition({ confirmationId: input.confirmationId });
        },
        [input.confirmationId]
    );

    const stop = () => {
        attempt.current++;
        setNotice(null);
        void stopMeasuredPreviewAudition({ confirmationId: input.confirmationId });
    };
    const play = (side: 'baseline' | 'preview') => {
        if (selected === undefined || !available) {
            return;
        }
        const currentAttempt = ++attempt.current;
        setNotice(null);
        void startMeasuredPreviewAudition({ ...input, targetId: selected.targetId, side }).then((result) => {
            if (attempt.current === currentAttempt && result.status === 'unavailable') {
                setNotice(result.reason);
            }
        });
    };
    return { view, selected, notice, available, stop, play, selectTarget: (targetId: string) => { stop(); setSelectedId(targetId); } };
}

/** The shared approval's only audible comparison; Confirm remains with its existing owner. */
export function MeasuredPreviewAudition(input: AuditionProps) {
    const { view, selected, notice, available, stop, play, selectTarget } = useAuditionControls(input);
    const phaseLabel = {
        idle: 'Stopped',
        acquiring: 'Preparing comparison…',
        playing: view.side === 'baseline' ? 'Playing baseline' : 'Playing proposal',
        releasing: 'Restoring playback…',
        'restore-failed': 'Listening output could not be restored',
    }[view.phase];
    return (
        <section
            aria-label="Measured audio comparison"
            data-confirmation-id={input.confirmationId}
            className="flex flex-col gap-1"
        >
            <p>Hear the measured proposal before confirming</p>
            <label>
                <span>Audition target</span>
                <select
                    aria-label="Audition target"
                    value={selected?.targetId ?? ''}
                    disabled={view.targets.length === 0}
                    onChange={(event) => selectTarget(event.currentTarget.value)}
                >
                    {view.targets.length === 0 ? <option value="">No retained audio</option> : null}
                    {view.targets.map((target) => (
                        <option key={target.targetId} value={target.targetId}>
                            {target.targetName}
                        </option>
                    ))}
                </select>
            </label>
            {selected?.available === true ? (
                <p>{`Loudness matched at ${selected.matchedLufs.toFixed(1)} LUFS`}</p>
            ) : null}
            <div className="flex gap-1">
                <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={!available}
                    onClick={() => play('baseline')}
                >
                    Baseline
                </Button>
                <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={!available}
                    onClick={() => play('preview')}
                >
                    Proposal
                </Button>
                <Button type="button" size="xs" variant="ghost" disabled={view.phase === 'idle'} onClick={stop}>
                    Stop comparison
                </Button>
            </div>
            <p role="status">{phaseLabel}</p>
            {view.reason === null ? null : <p>{view.reason}</p>}
            {selected?.available === false ? <p>{selected.reason}</p> : null}
            {view.error === null ? null : <p className="text-destructive">{view.error}</p>}
            {notice === null ? null : <p className="text-destructive">{notice}</p>}
        </section>
    );
}
