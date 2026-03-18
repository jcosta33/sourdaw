import { type ReactElement } from 'react';
import { setMidiOutput, clearMidiOutput } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackMidiOutputSectionProps = {
    track: Track;
    allTracks: Track[];
};

export const TrackMidiOutputSection = ({ track, allTracks }: TrackMidiOutputSectionProps): ReactElement => {
    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">MIDI Output</h3>
            <select
                className="w-full rounded border border-border bg-surface-overlay px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                value={track.midiOutputTrackId ?? ''}
                onChange={(e) => {
                    const val = e.target.value;
                    if (val) {
                        setMidiOutput(track.id, val);
                    } else {
                        clearMidiOutput(track.id);
                    }
                }}
                aria-label="MIDI output destination"
            >
                <option value="">No MIDI routing</option>
                {allTracks
                    .filter((t) => t.kind === 'midi' && t.id !== track.id)
                    .map((t) => (
                        <option key={t.id} value={t.id}>
                            {t.name}
                        </option>
                    ))}
            </select>
            {track.midiOutputTrackId && (
                <p className="mt-1 text-[9px] text-muted-foreground">
                    MIDI events from this track are routed to the destination track's instruments.
                </p>
            )}
        </section>
    );
};
