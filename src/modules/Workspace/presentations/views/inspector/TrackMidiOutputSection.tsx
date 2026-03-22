import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { setMidiOutput, clearMidiOutput } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

type TrackMidiOutputSectionProps = {
    track: Track;
    allTracks: Track[];
};

export const TrackMidiOutputSection = ({ track, allTracks }: TrackMidiOutputSectionProps): ReactElement => {
    return (
        <div>
            <div className="px-1 mb-2 border-b border-border-hairline pb-1">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    MIDI Output
                </div>
            </div>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2">
                    <select
                        className="w-full rounded-sm border border-border bg-surface-overlay px-2 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
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
                        <p className="mt-2 text-[9px] text-muted-foreground leading-tight">
                            MIDI events from this track are routed to the destination track's instruments.
                        </p>
                    )}
                </Card>
            </div>
        </div>
    );
};
