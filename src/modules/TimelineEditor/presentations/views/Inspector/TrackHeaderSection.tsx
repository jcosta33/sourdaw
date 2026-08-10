import { type ReactElement, useState } from 'react';

import { Snowflake, Zap, AlertCircle, RefreshCw } from 'lucide-react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawMeterBar } from '#/components/daw/DawMeterBar';
import { Button } from '#/components/ui/button';
import { Tooltip, TooltipTrigger, TooltipContent } from '#/components/ui/tooltip';
import {
    renameTrack,
    setTrackColor,
    freezeTrack,
    unfreezeTrack,
    cancelFreezeTrack,
} from '#/modules/Arrangement/useCases';
import { cn } from '#/utils/Styles/cn';
import { TRACK_COLOR_PRESETS } from '#/utils/UI/colorPresets';

import { type Track } from '../../../models/TrackViewTypes';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { MetaText } from '../../components/Inspector/MetaText';

type TrackHeaderSectionProps = {
    track: Track;
};

export const TrackHeaderSection = ({ track }: TrackHeaderSectionProps): ReactElement | null => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(track.name);

    const isFreezing = track.freezeState.status === 'freezing';
    const isStale = track.freezeState.status === 'stale';

    if (track.kind === 'master') {
        return null; // Master track name and color are fixed; streamline by hiding editing block.
    }

    const commitName = (): void => {
        if (nameValue.trim() && nameValue !== track.name) {
            renameTrack(track.id, nameValue.trim());
        }
        setEditingName(false);
    };
    const renderIife_16 = () => {
        if (track.kind !== 'folder') {
            const renderIife_17 = () => {
                if (isFreezing) {
                    return (
                        <div className="flex flex-col gap-1.5 min-w-32">
                            <div className="flex items-center justify-between">
                                <span className="text-[9px] font-bold text-primary animate-pulse uppercase tracking-wider">
                                    Freezing...
                                </span>
                                <span className="text-[10px] text-muted-foreground tabular-nums">
                                    {Math.round((track.freezeState.renderProgress ?? 0) * 100)}%
                                </span>
                            </div>
                            <DawMeterBar
                                value={(track.freezeState.renderProgress ?? 0) * 100}
                                size="sm"
                                fillClassName="bg-primary"
                            />
                            <Button
                                variant="ghost"
                                size="xs"
                                className="h-5 text-[9px] hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => cancelFreezeTrack(track.id)}
                            >
                                Cancel
                            </Button>
                        </div>
                    );
                } else {
                    const renderIife_18 = () => {
                        if (isStale) {
                            return <RefreshCw className="size-3" />;
                        }
                        if (track.frozen) {
                            return <Zap className="size-3" />;
                        }
                        return <Snowflake className="size-3" />;
                    };
                    const renderIife_19 = () => {
                        if (isStale) {
                            return 'Update Freeze';
                        }
                        if (track.frozen) {
                            return 'Unfreeze';
                        }
                        return 'Freeze';
                    };

                    return (
                        <>
                            {isStale ? (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        <div className="flex items-center gap-1 px-1.5 py-0.5 rounded bg-state-warning/20 border border-state-warning/30 text-state-warning cursor-help">
                                            <AlertCircle className="size-3" />
                                            <span className="text-[10px] font-bold uppercase tracking-tight">
                                                Stale
                                            </span>
                                        </div>
                                    </TooltipTrigger>
                                    <TooltipContent>Content has changed since freeze. Update required.</TooltipContent>
                                </Tooltip>
                            ) : null}
                            <Button
                                variant={track.frozen || isStale ? 'secondary' : 'ghost'}
                                size="xs"
                                className={cn(
                                    'h-6 gap-1.5 px-2',
                                    isStale && 'border-state-warning/40 text-state-warning hover:bg-state-warning/10'
                                )}
                                onClick={() => {
                                    if (track.frozen || isStale) {
                                        void unfreezeTrack(track.id);
                                    } else {
                                        void freezeTrack(track.id);
                                    }
                                }}
                                aria-pressed={track.frozen || isStale}
                            >
                                {renderIife_18()}
                                <span className="text-[10px] font-medium">{renderIife_19()}</span>
                            </Button>
                        </>
                    );
                }
            };

            return <div className="flex items-center gap-2">{renderIife_17()}</div>;
        } else {
            return null;
        }
    };

    return (
        <div className="flex flex-col">
            <InsetPanel tone="framed" className="space-y-3">
                <div>
                    <MetaText className="mb-1 block">Name</MetaText>
                    {editingName ? (
                        <DawCompactInput
                            value={nameValue}
                            onChange={(event) => setNameValue(event.target.value)}
                            onBlur={commitName}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
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

                    {renderIife_16()}
                </div>

                <div className="space-y-1.5 pt-1">
                    <MetaText className="block">Color</MetaText>
                    <div className="flex flex-wrap gap-1">
                        {TRACK_COLOR_PRESETS.map((context) => (
                            <button
                                type="button"
                                key={context}
                                className="size-4 rounded border border-border transition-transform hover:scale-125"
                                style={{
                                    backgroundColor: context,
                                    outline: context === track.color ? '2px solid white' : 'none',
                                    outlineOffset: '1px',
                                }}
                                onClick={() => setTrackColor(track.id, context)}
                                aria-pressed={context === track.color}
                                aria-label={`Set color ${context}`}
                            />
                        ))}
                    </div>
                </div>
            </InsetPanel>
        </div>
    );
};
