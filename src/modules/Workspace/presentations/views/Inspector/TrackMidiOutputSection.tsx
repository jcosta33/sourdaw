import { type ReactElement } from 'react';
import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { setMidiOutput, clearMidiOutput } from '#/modules/MIDI/useCases';
import { toggleChordTrackFollow } from '#/modules/Arrangement/useCases';
import { type Track } from '../../../models/TrackViewTypes';
import { SurfaceCard } from '../../components/Inspector/SurfaceCard';

type TrackMidiOutputSectionProps = {
    track: Track;
    allTracks: Track[];
};

export const TrackMidiOutputSection = ({ track, allTracks }: TrackMidiOutputSectionProps): ReactElement => {
    return (
        <div>
            <DawHeaderBand compact className="mb-2 rounded-sm" title="MIDI Output" />
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <SurfaceCard>
                    <DawCompactSelect
                        className="w-full border-border"
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
                    </DawCompactSelect>
                    {track.midiOutputTrackId ? (
                        <p className="mt-2 text-[9px] text-muted-foreground leading-tight">
                            MIDI events from this track are routed to the destination track's instruments.
                        </p>
                    ) : null}
                </SurfaceCard>

                <SurfaceCard>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <DawCompactCheckbox
                            checked={track.followChordTrack}
                            onChange={() => toggleChordTrackFollow(track.id)}
                            aria-label="Follow chord track"
                        />
                        <span className="text-[10px] text-foreground/80">Follow Chord Track</span>
                    </label>
                    <p className="mt-1.5 text-[9px] text-muted-foreground leading-tight">
                        Transpose MIDI notes in real-time based on the chord track. Notes are mapped relative to the
                        chord at each clip's start position.
                    </p>
                </SurfaceCard>
            </div>
        </div>
    );
};
