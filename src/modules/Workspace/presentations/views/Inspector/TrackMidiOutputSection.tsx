import { type ReactElement } from 'react';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Card } from '#/components/ui/card';
import { setMidiOutput, clearMidiOutput } from '#/modules/MIDI/useCases/midiRouting';
import { toggleChordTrackFollow } from '#/modules/Arrangement/useCases/toggleTrackState/toggleChordTrackFollow';
import { type Track } from '#/modules/Arrangement/useCases/trackQueries';

type TrackMidiOutputSectionProps = {
    track: Track;
    allTracks: Track[];
};

export const TrackMidiOutputSection = ({ track, allTracks }: TrackMidiOutputSectionProps): ReactElement => {
    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="MIDI Output" />
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
                    {track.midiOutputTrackId ? (
                        <p className="mt-2 text-[9px] text-muted-foreground leading-tight">
                            MIDI events from this track are routed to the destination track's instruments.
                        </p>
                    ) : null}
                </Card>

                <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={track.followChordTrack}
                            onChange={() => toggleChordTrackFollow(track.id)}
                            className="size-3 rounded border-border accent-[var(--color-accent-orange)]"
                            aria-label="Follow chord track"
                        />
                        <span className="text-[10px] text-foreground/80">Follow Chord Track</span>
                    </label>
                    <p className="mt-1.5 text-[9px] text-muted-foreground leading-tight">
                        Transpose MIDI notes in real-time based on the chord track. Notes are mapped
                        relative to the chord at each clip's start position.
                    </p>
                </Card>
            </div>
        </div>
    );
};
