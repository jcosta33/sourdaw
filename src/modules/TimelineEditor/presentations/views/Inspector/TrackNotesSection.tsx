import { type ReactElement, useState } from 'react';

import { DawCompactTextarea } from '#/components/daw/DawCompactTextarea';
import { setTrackNotes } from '#/modules/Arrangement/useCases';

import { type Track } from '../../../models/TrackViewTypes';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { MetaText } from '../../components/Inspector/MetaText';

type TrackNotesSectionProps = {
    track: Track;
};

// §198.1 — notes editor derives its draft from `track.notes` on every render
// so external mutations (undo, collab sync, track switch) are reflected
// immediately. The previous `useState(track.notes)` captured the value once
// at mount and then silently diverged from the store.
type NotesDraft = { trackId: string; lastSeen: string; value: string };

export const TrackNotesSection = ({ track }: TrackNotesSectionProps): ReactElement => {
    const [draft, setDraft] = useState<NotesDraft>({
        trackId: track.id,
        lastSeen: track.notes,
        value: track.notes,
    });

    // Resync when the selected track changes or when the persisted notes
    // value moves underneath us (undo / external write).
    if (draft.trackId !== track.id || draft.lastSeen !== track.notes) {
        setDraft({ trackId: track.id, lastSeen: track.notes, value: track.notes });
    }

    const notesValue = draft.value;

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
                onChange={(event) => setDraft({ trackId: track.id, lastSeen: track.notes, value: event.target.value })}
                onBlur={() => {
                    if (notesValue !== track.notes) {
                        setTrackNotes(track.id, notesValue);
                    }
                }}
                aria-label={`Notes for ${track.name}`}
                data-testid="inspector-track-notes"
            />
        </InsetPanel>
    );
};
