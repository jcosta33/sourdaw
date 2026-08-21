import { type ChangeEvent, type DragEvent, type ReactElement, useId, useState } from 'react';

import { Row, Stack } from '#/components/layout';
import { useStore } from '#/infra/store/useStore';
import { defaultTrackState, trackStore } from '#/modules/Arrangement/stores';
import { MIDI_CLIP_DRAG_MIME_TYPE } from '#/utils/midiClipDrag';

import { commitYeastGrooveExtraction } from '../../useCases/commitYeastGrooveExtraction';
import { proposeYeastGrooveExtraction } from '../../useCases/proposeYeastGrooveExtraction';

type Props = {
    subdivision?: string;
};

type Proposal = ReturnType<typeof proposeYeastGrooveExtraction>;
type ExtractedProposal = Extract<Proposal, { status: 'extracted' }>;
type CommitResult = Awaited<ReturnType<typeof commitYeastGrooveExtraction>>;
type CommitRejectionReason = Extract<CommitResult, { status: 'rejected' }>['reason'];
type ErrorState = { kind: 'drop' } | { kind: 'commit'; reason: CommitRejectionReason } | { kind: 'unexpected' };
type PreviewState = {
    subdivision: string;
    proposal: Proposal | null;
    error: ErrorState | null;
};

function getDroppedClipId(dataTransfer: DataTransfer): string | null {
    const typedClipId = dataTransfer.getData(MIDI_CLIP_DRAG_MIME_TYPE).trim();
    if (typedClipId.length > 0) {
        return typedClipId;
    }
    const plainClipId = dataTransfer.getData('text/plain').trim();
    return plainClipId.length > 0 ? plainClipId : null;
}

function getErrorMessage(error: ErrorState): string {
    if (error.kind === 'drop') {
        return 'The drop did not identify a MIDI clip.';
    }
    if (error.kind === 'unexpected') {
        return 'The groove template could not be saved.';
    }
    if (error.reason === 'source-revision-mismatch') {
        return 'The source clip changed. Preview the groove again before saving.';
    }
    if (error.reason === 'proposal-mismatch') {
        return 'The groove library changed. Preview the groove again before saving.';
    }
    if (error.reason === 'template-identity-conflict') {
        return 'A different groove template already uses this identity. Rename it or preview again.';
    }
    if (error.reason === 'empty-source') {
        return 'The source clip no longer contains MIDI notes. Choose another clip or preview again.';
    }
    if (error.reason === 'unsupported-subdivision') {
        return 'This subdivision is no longer supported. Choose another subdivision and preview again.';
    }
    return 'The source clip can no longer be analyzed. Choose another clip or preview again.';
}

function getProposalMessage(proposal: Proposal): string {
    if (proposal.status === 'extracted') {
        return `Previewing “${proposal.template.name}”`;
    }
    if (proposal.status === 'straight') {
        return 'This MIDI clip is already Straight.';
    }
    if (proposal.status === 'empty') {
        return 'This MIDI clip has no notes.';
    }
    if (proposal.status === 'unsupported') {
        return `Subdivision ${proposal.subdivision} is not supported.`;
    }
    if (proposal.status === 'invalid-source') {
        return `This MIDI clip cannot be analyzed: ${proposal.reason}.`;
    }
    return 'Drop an eligible MIDI clip.';
}

export const GrooveDropTarget = ({ subdivision = '1/16' }: Props): ReactElement => {
    const clipSelectId = useId();
    const trackState = useStore(trackStore, defaultTrackState);
    const [previewState, setPreviewState] = useState<PreviewState>({ subdivision, proposal: null, error: null });
    const [pendingProposal, setPendingProposal] = useState<ExtractedProposal | null>(null);
    const [selectedClipId, setSelectedClipId] = useState('');
    const saving = pendingProposal !== null;
    const midiClips = trackState.tracks.flatMap((track) =>
        track.clips
            .filter((clip) => clip.type === 'midi' && !clip.isGhost)
            .map((clip) => ({ id: clip.id, name: `${track.name} — ${clip.name}` }))
    );
    const canPreviewSelectedClip = midiClips.some((clip) => clip.id === selectedClipId);
    if (previewState.subdivision !== subdivision) {
        setPreviewState({ subdivision, proposal: null, error: null });
    }
    const proposal = previewState.proposal;
    const error = previewState.error;

    const previewClip = (clipId: string): void => {
        if (saving) {
            return;
        }
        setPreviewState({
            subdivision,
            proposal: proposeYeastGrooveExtraction({ clipId, subdivision }),
            error: null,
        });
    };

    const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.dataTransfer.dropEffect = saving ? 'none' : 'copy';
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        if (saving) {
            return;
        }
        const clipId = getDroppedClipId(event.dataTransfer);
        if (!clipId) {
            setPreviewState({ subdivision, proposal: null, error: { kind: 'drop' } });
            return;
        }
        setSelectedClipId(clipId);
        previewClip(clipId);
    };

    const handleSelectedClipChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        setSelectedClipId(event.target.value);
        setPreviewState({ subdivision, proposal: null, error: null });
    };

    const handleConfirm = async (): Promise<void> => {
        if (proposal?.status !== 'extracted') {
            return;
        }
        const committingProposal = proposal;
        setPendingProposal(committingProposal);
        setPreviewState((current) => ({ ...current, error: null }));
        try {
            const result = await commitYeastGrooveExtraction({
                clipId: committingProposal.clipId,
                sourceName: committingProposal.sourceName,
                subdivision: committingProposal.subdivision,
                templateId: committingProposal.template.id,
                proposal: structuredClone(committingProposal.template),
                sourceRevision: committingProposal.sourceRevision,
            });
            if (result.status === 'rejected') {
                setPreviewState((current) => ({
                    ...current,
                    error: { kind: 'commit', reason: result.reason },
                }));
                return;
            }
            setPreviewState((current) => ({
                ...current,
                proposal: current.proposal === committingProposal ? null : current.proposal,
            }));
        } catch {
            setPreviewState((current) => ({ ...current, error: { kind: 'unexpected' } }));
        } finally {
            setPendingProposal((currentProposal) => (currentProposal === committingProposal ? null : currentProposal));
        }
    };

    return (
        <Stack gap={1} className="px-1 pb-1" aria-busy={saving}>
            <label className="sr-only" htmlFor={clipSelectId}>
                MIDI clip for groove extraction
            </label>
            <Row align="stretch" gap={1}>
                <select id={clipSelectId} value={selectedClipId} disabled={saving} onChange={handleSelectedClipChange}>
                    <option value="">Select a MIDI clip</option>
                    {midiClips.map((clip) => (
                        <option key={clip.id} value={clip.id}>
                            {clip.name}
                        </option>
                    ))}
                </select>
                <button
                    type="button"
                    disabled={saving || !canPreviewSelectedClip}
                    onClick={() => previewClip(selectedClipId)}
                >
                    Preview groove
                </button>
            </Row>
            <div
                aria-label="Extract groove from MIDI clip"
                aria-disabled={saving}
                className="rounded border border-dashed border-border/40 px-2 py-1 text-center text-[7px] text-muted-foreground"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                Drop MIDI clip to extract groove
            </div>
            {proposal ? <p role="status">{getProposalMessage(proposal)}</p> : null}
            {proposal?.status === 'extracted' ? (
                <Row align="stretch" gap={1}>
                    <button type="button" disabled={saving} onClick={() => handleConfirm().catch(() => undefined)}>
                        {saving ? 'Saving…' : 'Save groove'}
                    </button>
                    <button
                        type="button"
                        disabled={saving}
                        onClick={() => setPreviewState({ subdivision, proposal: null, error: null })}
                    >
                        Cancel
                    </button>
                </Row>
            ) : null}
            {error ? <p role="alert">{getErrorMessage(error)}</p> : null}
        </Stack>
    );
};
