import { type ReactElement } from 'react';

import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { Row } from '#/components/layout';
import { toggleChordTrackFollow, updateTrack } from '#/modules/Arrangement/useCases';

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
                        onChange={(event) => {
                            const val = event.target.value;
                            updateTrack(track.id, (current) => ({
                                ...current,
                                midiOutputTrackId: val || null,
                            }));
                        }}
                        aria-label="MIDI output destination"
                    >
                        <option value="">No MIDI routing</option>
                        {allTracks
                            .filter((time) => time.kind === 'midi' && time.id !== track.id)
                            .map((time) => (
                                <option key={time.id} value={time.id}>
                                    {time.name}
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
                    <Row as="label" gap={2} className="cursor-pointer">
                        <DawCompactCheckbox
                            checked={track.followChordTrack}
                            onChange={() => toggleChordTrackFollow(track.id)}
                            aria-label="Follow chord track"
                        />
                        <span className="text-[10px] text-foreground/80">Follow Chord Track</span>
                    </Row>
                    <p className="mt-1.5 text-[9px] text-muted-foreground leading-tight">
                        Transpose MIDI notes in real-time based on the chord track. Notes are mapped relative to the
                        chord at each clip's start position.
                    </p>
                </SurfaceCard>
            </div>
        </div>
    );
};
