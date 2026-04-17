import { type ReactElement, useState } from 'react';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { Button } from '#/components/ui/button';
import { Snowflake, Zap, AlertCircle } from 'lucide-react';
import {
    renameTrack,
    setTrackColor,
    freezeTrack,
    unfreezeTrack,
} from '#/modules/Arrangement/useCases';
import { type Track } from '../../../models/TrackViewTypes';
import { TRACK_COLOR_PRESETS } from '#/utils/UI/colorPresets';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { MetaText } from '../../components/Inspector/MetaText';

type TrackHeaderSectionProps = {
    track: Track;
};

export const TrackHeaderSection = ({ track }: TrackHeaderSectionProps): ReactElement | null => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(track.name);

    if (track.kind === 'master') {
        return null; // Master track name and color are fixed; streamline by hiding editing block.
    }

    const commitName = (): void => {
        if (nameValue.trim() && nameValue !== track.name) {
            renameTrack(track.id, nameValue.trim());
        }
        setEditingName(false);
    };

    return (
        <div className="flex flex-col">
            <InsetPanel tone="framed" className="space-y-3">
                <div>
                    <MetaText className="mb-1 block">Name</MetaText>
                    {editingName ? (
                        <DawCompactInput
                            value={nameValue}
                            onChange={(e) => setNameValue(e.target.value)}
                            onBlur={commitName}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                    commitName();
                                }
                            }}
                            autoFocus
                        />
                    ) : (
                        <Button
                            variant="ghost"
                            size="xs"
                            className="w-full justify-start font-normal h-7 bg-surface-overlay border border-transparent hover:border-border/50"
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
                        <MetaText>Kind:</MetaText>
                        <span className="text-[10px] font-medium text-foreground capitalize">{track.kind}</span>
                    </div>

                    {track.kind !== 'folder' ? (
                        <div className="flex items-center gap-2">
                            {track.freezeState?.status === 'stale' && (
                                <span className="text-[10px] text-destructive flex items-center font-medium" title="Track content has changed since freezing">
                                    <AlertCircle className="size-3 mr-1" /> Stale
                                </span>
                            )}
                            <Button
                                variant={track.freezeState?.status === 'frozen' || track.freezeState?.status === 'stale' ? 'secondary' : 'ghost'}
                                size="xs"
                                className="h-6"
                                onClick={() => {
                                    if (track.freezeState?.status === 'frozen' || track.freezeState?.status === 'stale') {
                                        unfreezeTrack(track.id);
                                    } else {
                                        freezeTrack(track.id);
                                    }
                                }}
                                aria-pressed={track.freezeState?.status === 'frozen' || track.freezeState?.status === 'stale'}
                            >
                                {track.freezeState?.status === 'frozen' || track.freezeState?.status === 'stale' ? <Zap className="size-3 mr-1" /> : <Snowflake className="size-3 mr-1" />}
                                {track.freezeState?.status === 'stale' ? 'Update Freeze' : track.freezeState?.status === 'frozen' ? 'Unfreeze' : 'Freeze'}
                            </Button>
                        </div>
                    ) : null}
                </div>

                <div className="space-y-1.5 pt-1">
                    <MetaText className="block">Color</MetaText>
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
            </InsetPanel>
        </div>
    );
};
