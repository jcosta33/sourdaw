import { type ReactElement, useState } from 'react';
import { Input } from '#/components/ui/input';
import { Button } from '#/components/ui/button';
import { Snowflake, Zap } from 'lucide-react';
import { renameTrack } from '../../../useCases/workspaceViewActions';
import { setTrackNotes, setTrackColor } from '../../../useCases/workspaceViewActions';
import { freezeTrack, unfreezeTrack } from '../../../useCases/workspaceViewActions';
import { type Track } from '../../../useCases/workspaceViewActions';
import { TRACK_COLOR_PRESETS } from './colorPresets';
import {
    createTrackAlternative,
    switchTrackAlternative,
} from '#/modules/Track/useCases/trackAlternativeUseCases';
import { Plus } from 'lucide-react';

export type TrackHeaderSectionProps = {
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
        <section>
            <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Track</h3>
            <div className="space-y-2">
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
                            className="h-7 text-xs"
                            autoFocus
                        />
                    ) : (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="w-full justify-start font-normal"
                            onClick={() => {
                                setEditingName(true);
                                setNameValue(track.name);
                            }}
                        >
                            {track.name}
                        </Button>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-[10px] text-muted-foreground w-8">Kind</label>
                    <span className="text-xs text-foreground capitalize">{track.kind}</span>
                </div>

                <div className="flex items-center gap-2">
                    <label className="text-[10px] text-muted-foreground w-8">Color</label>
                    <div className="flex gap-1">
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

                {track.kind !== 'folder' && (
                    <div className="flex items-center gap-1">
                        <Button
                            variant={track.frozen ? 'secondary' : 'ghost'}
                            size="xs"
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
                    </div>
                )}

                {/* Track alternatives */}
                {track.alternatives.length > 0 && (
                    <div className="flex items-center gap-1">
                        <label className="text-[10px] text-muted-foreground shrink-0">Alt</label>
                        <select
                            value={track.activeAlternativeId}
                            onChange={(e) => switchTrackAlternative(track.id, e.target.value)}
                            className="h-5 flex-1 rounded border border-border/50 bg-surface-overlay px-1 text-[9px] text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            aria-label="Track alternative"
                        >
                            {track.alternatives.map((alt) => (
                                <option key={alt.id} value={alt.id}>
                                    {alt.name}
                                </option>
                            ))}
                        </select>
                        <Button
                            variant="ghost"
                            size="icon-xs"
                            title="New alternative"
                            aria-label="Create new track alternative"
                            onClick={() => createTrackAlternative(track.id, undefined, true)}
                        >
                            <Plus className="size-3" />
                        </Button>
                    </div>
                )}

                <div>
                    <label className="text-[10px] text-muted-foreground">Notes</label>
                    <textarea
                        className="mt-1 w-full rounded border border-border bg-surface-overlay px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring resize-y"
                        rows={2}
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
                </div>
            </div>
        </section>
    );
};
