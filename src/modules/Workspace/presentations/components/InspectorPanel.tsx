import { type ReactElement, useState } from "react";
import { ScrollArea } from "#/components/ui/scroll-area";
import { Slider } from "#/components/ui/slider";
import { Input } from "#/components/ui/input";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { useTracks } from "#/modules/Track/presentations/hooks/useTracks";
import { renameTrack } from "#/modules/Track/useCases/renameTrack";
import type { Track } from "#/modules/Track/models/Track";

export const InspectorPanel = (): ReactElement => {
    const { tracks, selectedTrackId } = useTracks();
    const selectedTrack = tracks.find((t) => t.id === selectedTrackId);

    return (
        <aside
            className="flex w-(--spacing-inspector-width) shrink-0 flex-col border-l border-border/50 bg-surface-raised"
            aria-label="Inspector panel"
        >
            <div className="border-b border-border/50 px-3 py-2">
                <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Inspector
                </h2>
            </div>

            <ScrollArea className="flex-1">
                {selectedTrack ? (
                    <TrackInspector track={selectedTrack} />
                ) : (
                    <div className="p-3">
                        <p className="text-xs text-muted-foreground">
                            Select a track, clip, or device to inspect its properties.
                        </p>
                    </div>
                )}
            </ScrollArea>
        </aside>
    );
};

const TrackInspector = ({ track }: { track: Track }): ReactElement => {
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(track.name);

    const commitName = () => {
        if (nameValue.trim() && nameValue !== track.name) {
            renameTrack(track.id, nameValue.trim());
        }
        setEditingName(false);
    };

    return (
        <div className="space-y-4 p-3">
            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Track
                </h3>

                <div className="space-y-2">
                    <div>
                        <label className="text-[10px] text-muted-foreground">Name</label>
                        {editingName ? (
                            <Input
                                value={nameValue}
                                onChange={(e) => setNameValue(e.target.value)}
                                onBlur={commitName}
                                onKeyDown={(e) => { if (e.key === "Enter") commitName(); }}
                                className="h-7 text-xs"
                                autoFocus
                            />
                        ) : (
                            <Button
                                variant="ghost"
                                size="xs"
                                className="w-full justify-start font-normal"
                                onClick={() => { setEditingName(true); setNameValue(track.name); }}
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
                        <div
                            className="size-4 rounded border border-border"
                            style={{ backgroundColor: track.color }}
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Level
                </h3>

                <div className="space-y-3">
                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Gain</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{(track.gain * 100).toFixed(0)}%</span>
                        </div>
                        <Slider
                            defaultValue={[track.gain * 100]}
                            max={100}
                            step={1}
                            aria-label={`${track.name} gain`}
                        />
                    </div>

                    <div>
                        <div className="flex items-center justify-between mb-1">
                            <label className="text-[10px] text-muted-foreground">Pan</label>
                            <span className="text-[10px] font-mono text-muted-foreground">{track.pan === 0 ? "C" : track.pan > 0 ? `R${track.pan}` : `L${Math.abs(track.pan)}`}</span>
                        </div>
                        <Slider
                            defaultValue={[track.pan + 50]}
                            max={100}
                            step={1}
                            aria-label={`${track.name} pan`}
                        />
                    </div>
                </div>
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Devices
                </h3>
                {track.devices.length > 0 ? (
                    <div className="space-y-1">
                        {track.devices.map((device) => (
                            <div key={device.id} className="flex items-center justify-between rounded bg-surface-overlay px-2 py-1.5">
                                <span className="text-xs text-foreground">{device.name}</span>
                                <Button variant="ghost" size="icon-xs" aria-label={`Bypass ${device.name}`}>
                                    <span className="text-[10px]">{device.bypassed ? "OFF" : "ON"}</span>
                                </Button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No devices. Drag a plugin here.</p>
                )}
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Sends
                </h3>
                {track.sends.length > 0 ? (
                    <div className="space-y-1">
                        {track.sends.map((send, i) => (
                            <div key={i} className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground">Bus {send.busId}</span>
                                <span className="text-[10px] font-mono text-muted-foreground">{(send.level * 100).toFixed(0)}%</span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No sends configured.</p>
                )}
            </section>

            <Separator />

            <section>
                <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                    Clips ({track.clips.length})
                </h3>
                {track.clips.length > 0 ? (
                    <div className="space-y-1">
                        {track.clips.map((clip) => (
                            <div key={clip.id} className="rounded bg-surface-overlay px-2 py-1.5">
                                <span className="text-xs text-foreground">{clip.name}</span>
                                <span className="ml-1 text-[10px] text-muted-foreground">
                                    bar {Math.floor(clip.startBeat / 4) + 1}–{Math.floor(clip.endBeat / 4) + 1}
                                </span>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-[10px] text-muted-foreground">No clips on this track.</p>
                )}
            </section>
        </div>
    );
};
