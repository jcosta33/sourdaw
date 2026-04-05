import { type ReactElement, useState } from 'react';
import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { setTrackNotes } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { type Track } from '../../../models/TrackViewTypes';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { MetaText } from '../../components/Inspector/MetaText';

type TrackNotesSectionProps = {
    track: Track;
};

export const TrackNotesSection = ({ track }: TrackNotesSectionProps): ReactElement => {
    const [notesValue, setNotesValue] = useState(track.notes);

    return (
        <InsetPanel
            className="flex flex-col"
            style={{
                borderTop: '1px solid rgba(255,255,255,0.05)',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
                borderBottom: '1px solid rgba(0,0,0,0.3)',
                borderRight: '1px solid rgba(0,0,0,0.2)',
            }}
        >
            <MetaText className="mb-1">Notes</MetaText>
            <DawCompactTextarea
                className="min-h-[60px] flex-1 resize-y"
                placeholder="Add notes…"
                value={notesValue}
                onChange={(e) => setNotesValue(e.target.value)}
                onBlur={() => {
                    if (notesValue !== track.notes) {
                        setTrackNotes(track.id, notesValue);
                    }
                }}
                aria-label={`Notes for ${track.name}`}
            />
        </InsetPanel>
    );
};
