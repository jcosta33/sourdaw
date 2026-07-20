import { type DragEvent, type ReactElement, useState } from 'react';

import { commitYeastGrooveExtraction } from '../../useCases/commitYeastGrooveExtraction';
import { proposeYeastGrooveExtraction } from '../../useCases/proposeYeastGrooveExtraction';

const MIDI_CLIP_MIME_TYPE = 'application/x-sourdaw-midi-clip';

type Props = {
    subdivision?: string;
};

type Proposal = ReturnType<typeof proposeYeastGrooveExtraction>;

function getDroppedClipId(dataTransfer: DataTransfer): string | null {
    const typedClipId = dataTransfer.getData(MIDI_CLIP_MIME_TYPE).trim();
    if (typedClipId.length > 0) {
        return typedClipId;
    }
    const plainClipId = dataTransfer.getData('text/plain').trim();
    return plainClipId.length > 0 ? plainClipId : null;
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
    const [proposal, setProposal] = useState<Proposal | null>(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const handleDragOver = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = (event: DragEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const clipId = getDroppedClipId(event.dataTransfer);
        if (!clipId) {
            setProposal(null);
            setError('The drop did not identify a MIDI clip.');
            return;
        }
        setError(null);
        setProposal(proposeYeastGrooveExtraction({ clipId, subdivision }));
    };

    const handleConfirm = async (): Promise<void> => {
        if (proposal?.status !== 'extracted') {
            return;
        }
        setSaving(true);
        setError(null);
        try {
            await commitYeastGrooveExtraction({
                clipId: proposal.clipId,
                sourceName: proposal.sourceName,
                subdivision: proposal.subdivision,
                templateId: proposal.template.id,
            });
            setProposal(null);
        } catch {
            setError('The groove template could not be saved.');
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="flex flex-col gap-1 px-1 pb-1">
            <div
                aria-label="Extract groove from MIDI clip"
                className="rounded border border-dashed border-border/40 px-2 py-1 text-center text-[7px] text-muted-foreground"
                onDragOver={handleDragOver}
                onDrop={handleDrop}
            >
                Drop MIDI clip to extract groove
            </div>
            {proposal ? <p role="status">{getProposalMessage(proposal)}</p> : null}
            {proposal?.status === 'extracted' ? (
                <div className="flex gap-1">
                    <button type="button" disabled={saving} onClick={() => handleConfirm().catch(() => undefined)}>
                        Save groove
                    </button>
                    <button type="button" disabled={saving} onClick={() => setProposal(null)}>
                        Cancel
                    </button>
                </div>
            ) : null}
            {error ? <p role="alert">{error}</p> : null}
        </div>
    );
};
