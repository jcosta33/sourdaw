import { type ReactElement } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '#/components/ui/card';
import { Slider } from '#/components/ui/slider';
import { Knob } from '#/components/ui/knob';
import { MidiLearnButton } from '#/modules/Track/presentations/views/MidiLearnButton';
import { setTrackGain, setTrackPan } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';

export type TrackLevelSectionProps = {
    track: Track;
};

export const TrackLevelSection = ({ track }: TrackLevelSectionProps): ReactElement => {
    return (
        <Card className="rounded-md shadow-none bg-surface-base border-border/50">
            <CardHeader className="p-3 pb-2 border-b border-border/30">
                <CardTitle className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Level</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-4 space-y-4">
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
                            <MidiLearnButton targetType="trackPan" trackId={track.id} />
                        </div>
                    </div>
                    <Knob
                        className="mt-2 mx-auto"
                        value={track.pan + 50}
                        onValueChange={(v) => {
                            if (v !== undefined) {
                                setTrackPan(track.id, v - 50);
                            }
                        }}
                        defaultValue={50}
                        min={0}
                        max={100}
                        step={1}
                        size={32}
                        aria-label={`${track.name} pan`}
                        formatValue={(v) => {
                            const p = v - 50;
                            return p === 0 ? 'C' : p > 0 ? `R${p}` : `L${Math.abs(p)}`;
                        }}
                    />
                </div>
            </CardContent>
        </Card>
    );
};
