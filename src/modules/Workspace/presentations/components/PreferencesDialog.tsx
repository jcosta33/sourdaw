import { type ReactElement, useSyncExternalStore, useState, useEffect, useRef } from "react";
import { Button } from "#/components/ui/button";
import { Separator } from "#/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "#/components/ui/dialog";
import { Sun, Moon, KeyboardMusic, AudioLines } from "lucide-react";
import { MidiDevicePicker } from "#/modules/AudioEngine/presentations/components/MidiDevicePicker";
import { AudioDevicePicker } from "#/modules/AudioEngine/presentations/components/AudioDevicePicker";
import { PluginScanSettings } from "#/modules/AudioEngine/presentations/components/PluginScanSettings";
import { preferencesStore } from "../../stores/preferencesStore";
import { defaultPreferences, type Preferences, GRID_SNAP_OPTIONS, type GridSnapOption } from "../../models/Preferences";

type PreferencesDialogProps = {
    open: boolean;
    onClose: () => void;
};

export const PreferencesDialog = ({ open, onClose }: PreferencesDialogProps): ReactElement => {
    const prefs = useSyncExternalStore(
        (cb) => preferencesStore.subscribe(cb),
        () => preferencesStore.value ?? defaultPreferences,
    );

    const update = (partial: Partial<Preferences>) => {
        preferencesStore.set({ ...prefs, ...partial });
    };

    const trackHeights: Preferences["trackHeight"][] = ["compact", "normal", "large"];

    return (
        <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) { onClose(); } }}>
            <DialogContent className="w-[420px] max-h-[85vh] overflow-y-auto bg-surface-raised">
                <DialogHeader>
                    <DialogTitle className="text-sm font-semibold">Preferences</DialogTitle>
                </DialogHeader>

                <div className="space-y-4">
                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Track Height</label>
                        <div className="flex gap-2">
                            {trackHeights.map((h) => (
                                <Button
                                    key={h}
                                    variant={prefs.trackHeight === h ? "secondary" : "outline"}
                                    size="sm"
                                    onClick={() => update({ trackHeight: h })}
                                    className="capitalize"
                                >
                                    {h}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <Separator />

                    <GridSubdivisionSection
                        value={prefs.gridSubdivision}
                        onChange={(v) => update({ gridSubdivision: v })}
                    />

                    <Separator />

                    <section className="space-y-3">
                        <ToggleRow
                            label="Snap to Grid"
                            value={prefs.snapToGrid}
                            onChange={(v) => update({ snapToGrid: v })}
                        />
                        <ToggleRow
                            label="Auto Save"
                            value={prefs.autoSave}
                            onChange={(v) => update({ autoSave: v })}
                        />
                        <ToggleRow
                            label="Colorblind Mode"
                            value={prefs.colorblindMode}
                            onChange={(v) => update({ colorblindMode: v })}
                        />
                        <ToggleRow
                            label="Show Minimap"
                            value={prefs.showMinimap}
                            onChange={(v) => update({ showMinimap: v })}
                        />
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Theme</label>
                        <div className="flex gap-2">
                            {(["dark", "light"] as const).map((t) => (
                                <Button
                                    key={t}
                                    variant={prefs.theme === t ? "secondary" : "outline"}
                                    size="sm"
                                    onClick={() => {
                                        update({ theme: t });
                                        document.documentElement.classList.toggle("dark", t === "dark");
                                        document.documentElement.classList.toggle("light", t === "light");
                                    }}
                                    className="capitalize gap-1"
                                >
                                    {t === "dark" ? <Moon className="size-3" /> : <Sun className="size-3" />}
                                    {t}
                                </Button>
                            ))}
                        </div>
                    </section>

                    <Separator />

                    <VoiceKeyEditor
                        currentKey={prefs.voiceCommandKey}
                        onChange={(key) => update({ voiceCommandKey: key })}
                    />

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            <AudioLines className="size-3" aria-hidden="true" />
                            Audio Devices
                        </label>
                        <AudioDevicePicker />
                    </section>

                    <Separator />

                    <section>
                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1">
                            <KeyboardMusic className="size-3" aria-hidden="true" />
                            MIDI Input
                        </label>
                        <MidiDevicePicker />
                    </section>

                    <Separator />

                    <PluginScanSettings />

                    <Separator />

                    <div className="flex justify-end gap-2">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => preferencesStore.set(defaultPreferences)}
                        >
                            Reset to Defaults
                        </Button>
                        <Button size="sm" onClick={onClose}>Done</Button>
                    </div>
                </div>
            </DialogContent>
        </Dialog>
    );
};

const VoiceKeyEditor = ({ currentKey, onChange }: { currentKey: string; onChange: (key: string) => void }): ReactElement => {
    const [listening, setListening] = useState(false);
    const ref = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (!listening) {
            return;
        }
        const handler = (e: KeyboardEvent) => {
            e.preventDefault();
            e.stopPropagation();
            if (e.key.length === 1) {
                onChange(e.key.toLowerCase());
            }
            setListening(false);
        };
        window.addEventListener("keydown", handler, true);
        return () => window.removeEventListener("keydown", handler, true);
    }, [listening, onChange]);

    return (
        <section>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">
                Voice Command Key
            </label>
            <div className="flex items-center gap-2">
                <button
                    ref={ref}
                    className={`rounded px-3 py-1.5 text-xs font-mono border transition-colors ${listening ? "border-primary bg-primary/10 text-primary animate-pulse" : "border-border bg-surface-overlay text-foreground"}`}
                    onClick={() => setListening(true)}
                >
                    {listening ? "Press a key..." : currentKey.toUpperCase()}
                </button>
                <span className="text-[10px] text-muted-foreground">
                    {listening ? "Listening for keypress" : "Click to change — hold to activate voice input"}
                </span>
            </div>
        </section>
    );
};

const GRID_GROUPS: { label: string; options: GridSnapOption[] }[] = [
    { label: "Standard", options: ["bar", "beat", "1/2", "1/4", "1/8", "1/16", "1/32"] },
    { label: "Triplet", options: ["1/4T", "1/8T", "1/16T"] },
    { label: "Dotted", options: ["1/4D", "1/8D"] },
    { label: "", options: ["off"] },
];

const GridSubdivisionSection = ({ value, onChange }: { value: GridSnapOption; onChange: (v: GridSnapOption) => void }): ReactElement => {
    return (
        <section>
            <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-2 block">Grid Snap</label>
            <div className="space-y-1.5">
                {GRID_GROUPS.map((group) => (
                    <div key={group.label || "misc"} className="flex flex-wrap gap-1 items-center">
                        {group.label && (
                            <span className="text-[9px] text-muted-foreground/60 w-12 shrink-0">{group.label}</span>
                        )}
                        {group.options.map((opt) => {
                            const entry = GRID_SNAP_OPTIONS.find((o) => o.value === opt);
                            return (
                                <Button
                                    key={opt}
                                    variant={value === opt ? "secondary" : "ghost"}
                                    size="xs"
                                    onClick={() => onChange(opt)}
                                >
                                    {entry?.label ?? opt}
                                </Button>
                            );
                        })}
                    </div>
                ))}
            </div>
        </section>
    );
};

const ToggleRow = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }): ReactElement => {
    return (
        <div className="flex items-center justify-between">
            <span className="text-xs text-foreground">{label}</span>
            <button
                role="switch"
                aria-checked={value}
                className={`relative h-5 w-9 rounded-full transition-colors ${value ? "bg-primary" : "bg-muted/50"}`}
                onClick={() => onChange(!value)}
            >
                <span
                    className={`absolute top-0.5 left-0.5 size-4 rounded-full bg-white transition-transform ${value ? "translate-x-4" : ""}`}
                />
            </button>
        </div>
    );
};
