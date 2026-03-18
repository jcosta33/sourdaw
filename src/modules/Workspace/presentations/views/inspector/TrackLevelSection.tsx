import { type ReactElement } from 'react';
import { Slider } from '#/components/ui/slider';
import { MidiLearnButton } from '#/modules/Track/presentations/views/MidiLearnButton';
import { setTrackGain, setTrackPan } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackLevelSectionProps = {
    track: Track;
};

export const TrackLevelSection = ({ track }: TrackLevelSectionProps): ReactElement => {
    return (
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Level</h3>
            <div className="space-y-3">
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] text-muted-foreground">Gain</label>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-muted-foreground">
                                {(track.gain * 100).toFixed(0)}%
                            </span>
                            <MidiLearnButton targetType="trackGain" trackId={track.id} />
                        </div>
                    </div>
                    <Slider
                        value={[track.gain * 100]}
                        onValueChange={([v]) => {
                            if (v !== undefined) {
                                setTrackGain(track.id, v / 100);
                            }
                        }}
                        max={100}
                        step={1}
                        aria-label={`${track.name} gain`}
                    />
                </div>
                <div>
                    <div className="flex items-center justify-between mb-1">
                        <label className="text-[10px] text-muted-foreground">Pan</label>
                        <div className="flex items-center gap-1">
                            <span className="text-[10px] font-mono text-muted-foreground">
                                {track.pan === 0 ? 'C' : track.pan > 0 ? `R${track.pan}` : `L${Math.abs(track.pan)}`}
                            </span>
                            <MidiLearnButton targetType="trackPan" trackId={track.id} />
                        </div>
                    </div>
                    <Slider
                        value={[track.pan + 50]}
                        onValueChange={([v]) => {
                            if (v !== undefined) {
                                setTrackPan(track.id, v - 50);
                            }
                        }}
                        max={100}
                        step={1}
                        aria-label={`${track.name} pan`}
                    />
                </div>
            </div>
        </section>
    );
};
