import { type ReactElement, useState } from 'react';
import { Card } from '#/components/ui/card';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { Snowflake, Zap } from 'lucide-react';
import { renameTrack } from '#/modules/Arrangement/useCases/renameTrack';
import {
    setTrackNotes,
    setTrackColor,
} from '#/modules/Arrangement/useCases/setTrackGainPan';
import { freezeTrack, unfreezeTrack } from '#/modules/Arrangement/useCases/freezeBounce';
import { type Track } from '#/modules/Arrangement/models/Track';
import { TRACK_COLOR_PRESETS } from '#/helpers/UI/colorPresets';

type TrackHeaderSectionProps = {
    track: Track;
};

export const TrackHeaderSection = ({ track }: TrackHeaderSectionProps): ReactElement => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(track.name);
    const [notesValue, setNotesValue] = useState(track.notes);

    const commitName = (): void => {
        if (nameValue.trim() && nameValue !== track.name) {
            renameTrack(track.id, nameValue.trim());
        }
        setEditingName(false);
    };

    return (
        <div>
            <div className="px-1 mb-2 border-b border-border-hairline pb-1">
                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Track</div>
            </div>
            <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 space-y-3">
                    <div>
                        <label className="text-[10px] text-muted-foreground">Name</label>
                        {editingName ? (
                            <Input
                                value={nameValue}
                                onChange={(e) => setNameValue(e.target.value)}
                                onBlur={commitName}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                        commitName();
                                    }
                                }}
                                className="h-7 text-xs mt-1"
                                autoFocus
                            />
                        ) : (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="w-full justify-start font-normal h-7 mt-1 bg-surface-overlay border border-transparent hover:border-border/50"
                                onClick={() => {
                                    setEditingName(true);
                                    setNameValue(track.name);
                                }}
                            >
                                {track.name}
                            </Button>
                        )}
                    </div>

                    <div className="flex items-center gap-2 justify-between">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground">Kind:</span>
                            <span className="text-[10px] font-medium text-foreground capitalize">{track.kind}</span>
                        </div>

                        {track.kind !== 'folder' ? (
                            <Button
                                variant={track.frozen ? 'secondary' : 'ghost'}
                                size="xs"
                                className="h-6"
                                onClick={() => {
                                    if (track.frozen) {
                                        unfreezeTrack(track.id);
                                    } else {
                                        freezeTrack(track.id);
                                    }
                                }}
                                aria-pressed={track.frozen}
                            >
                                {track.frozen ? <Zap className="size-3 mr-1" /> : <Snowflake className="size-3 mr-1" />}
                                {track.frozen ? 'Unfreeze' : 'Freeze'}
                            </Button>
                        ) : null}
                    </div>

                    <div className="space-y-1.5">
                        <label className="text-[10px] text-muted-foreground block">Color</label>
                        <div className="flex flex-wrap gap-1">
                            {TRACK_COLOR_PRESETS.map((c) => (
                                <button
                                    type="button"
                                    key={c}
                                    className="size-4 rounded border border-border transition-transform hover:scale-125"
                                    style={{
                                        backgroundColor: c,
                                        outline: c === track.color ? '2px solid white' : 'none',
                                        outlineOffset: '1px',
                                    }}
                                    onClick={() => setTrackColor(track.id, c)}
                                    aria-label={`Set color`}
                                />
                            ))}
                        </div>
                    </div>
                </Card>

                <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex flex-col">
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
            </div>
        </div>
    );
};
