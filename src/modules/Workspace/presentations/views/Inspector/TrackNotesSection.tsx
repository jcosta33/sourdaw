import { type ReactElement, useState } from 'react';
import { Card } from '#/components/ui/card';
import { setTrackNotes } from '#/modules/Arrangement/useCases/setTrackGainPan';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

type TrackNotesSectionProps = {
    track: Track;
};

export const TrackNotesSection = ({ track }: TrackNotesSectionProps): ReactElement => {
    const [notesValue, setNotesValue] = useState(track.notes);

    return (
        <Card
            className="rounded-md bg-surface-well shadow-[inset_0_1px_3px_rgba(0,0,0,0.4)] p-2 flex flex-col"
            style={{
                borderTop: '1px solid rgba(255,255,255,0.05)',
                borderLeft: '1px solid rgba(255,255,255,0.04)',
                borderBottom: '1px solid rgba(0,0,0,0.3)',
                borderRight: '1px solid rgba(0,0,0,0.2)',
            }}
        >
            <label className="text-[10px] text-muted-foreground mb-1">Notes</label>
            <textarea
                className="flex-1 w-full rounded border border-border-soft bg-surface-inset shadow-[inset_0_1px_3px_rgba(0,0,0,0.6)] px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-border-focus resize-y min-h-[60px]"
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
        </Card>
    );
};
