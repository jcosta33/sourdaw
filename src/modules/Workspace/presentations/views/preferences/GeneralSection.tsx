import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';
import { Settings } from 'lucide-react';
import type { Preferences, SoloModePreference } from '../../../models/Preferences';
import { SectionTitle, FieldGroup, ToggleRow, VoiceKeyEditor, GridSubdivisionSection } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

export const GeneralSection = ({ prefs, update }: SectionProps): ReactElement => {
    const trackHeights: Preferences['trackHeight'][] = ['compact', 'normal', 'large'];

    return (
        <>
            <SectionTitle icon={<Settings className="size-4" />} title="General" />

            <FieldGroup label="Track Height">
                <div className="flex gap-2">
                    {trackHeights.map((h) => (
                        <Button
                            key={h}
                            variant={prefs.trackHeight === h ? 'secondary' : 'outline'}
                            size="sm"
                            onClick={() => update({ trackHeight: h })}
                            className="capitalize"
                        >
                            {h}
                        </Button>
                    ))}
                </div>
            </FieldGroup>

            <GridSubdivisionSection value={prefs.gridSubdivision} onChange={(v) => update({ gridSubdivision: v })} />

            <Separator />

            <div className="space-y-3">
                <ToggleRow label="Snap to Grid" value={prefs.snapToGrid} onChange={(v) => update({ snapToGrid: v })} />
                <ToggleRow label="Snap to Zero Crossing" value={prefs.snapToZeroCrossing} onChange={(v) => update({ snapToZeroCrossing: v })} />
                <ToggleRow label="Auto Save" value={prefs.autoSave} onChange={(v) => update({ autoSave: v })} />
                <ToggleRow
                    label="Show Minimap"
                    value={prefs.showMinimap}
                    onChange={(v) => update({ showMinimap: v })}
                />
            </div>

            <Separator />

            <FieldGroup label="Metronome">
                <div className="space-y-2">
                    <ToggleRow
                        label="Enabled"
                        value={prefs.metronomeEnabled}
                        onChange={(v) => update({ metronomeEnabled: v })}
                    />
                    {prefs.metronomeEnabled ? (
                        <div className="space-y-1">
                            <label className="text-[10px] text-muted-foreground block">Volume</label>
                            <Slider
                                value={[prefs.metronomeVolume * 100]}
                                onValueChange={([v]) => {
                                    if (v !== undefined) {
                                        update({ metronomeVolume: v / 100 });
                                    }
                                }}
                                max={100}
                                step={1}
                                className="w-full"
                                aria-label="Metronome volume"
                            />
                        </div>
                    ) : null}
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Recording">
                <div className="space-y-3">
                    <div className="space-y-1">
                        <label className="text-[10px] text-muted-foreground block">Count-In (bars)</label>
                        <div className="flex gap-1">
                            {([0, 1, 2, 4] as const).map((bars) => (
                                <Button
                                    key={bars}
                                    variant={prefs.recordCountIn === bars ? 'secondary' : 'ghost'}
                                    size="xs"
                                    onClick={() => update({ recordCountIn: bars })}
                                >
                                    {bars === 0 ? 'Off' : `${bars}`}
                                </Button>
                            ))}
                        </div>
                    </div>
                    <div className="space-y-1">
                        <div className="flex items-center justify-between">
                            <span className="text-xs text-foreground">Pre-roll</span>
                            <Button
                                variant={prefs.preRollEnabled ? 'secondary' : 'ghost'}
                                size="xs"
                                onClick={() => update({ preRollEnabled: !prefs.preRollEnabled })}
                            >
                                {prefs.preRollEnabled ? 'On' : 'Off'}
                            </Button>
                        </div>
                        {prefs.preRollEnabled ? (
                            <div className="space-y-1">
                                <label className="text-[10px] text-muted-foreground block">Pre-roll bars</label>
                                <div className="flex gap-1">
                                    {([1, 2, 4] as const).map((bars) => (
                                        <Button
                                            key={bars}
                                            variant={prefs.preRollBars === bars ? 'secondary' : 'ghost'}
                                            size="xs"
                                            onClick={() => update({ preRollBars: bars })}
                                        >
                                            {bars}
                                        </Button>
                                    ))}
                                </div>
                            </div>
                        ) : null}
                    </div>
                </div>
            </FieldGroup>

            <Separator />

            <FieldGroup label="Mixer">
                <div className="space-y-1">
                    <label className="text-[10px] text-muted-foreground block">Solo Mode</label>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                        Determines how soloed tracks affect others. SIP (Solo In Place) is standard.
                    </p>
                    <div className="flex gap-1">
                        {[
                            {
                                value: 'sip' as SoloModePreference,
                                label: 'SIP',
                                desc: 'Solo In Place — mute all others',
                            },
                            {
                                value: 'afl' as SoloModePreference,
                                label: 'AFL',
                                desc: 'After Fader Listen — monitor at fader gain',
                            },
                            {
                                value: 'pfl' as SoloModePreference,
                                label: 'PFL',
                                desc: 'Pre-Fader Listen — monitor at unity gain',
                            },
                        ].map((mode) => (
                            <Tooltip key={mode.value}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={prefs.soloMode === mode.value ? 'secondary' : 'ghost'}
                                        size="xs"
                                        onClick={() => update({ soloMode: mode.value })}
                                    >
                                        {mode.label}
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>{mode.desc}</TooltipContent>
                            </Tooltip>
                        ))}
                    </div>
                </div>
            </FieldGroup>

            <VoiceKeyEditor currentKey={prefs.voiceCommandKey} onChange={(key) => update({ voiceCommandKey: key })} />
        </>
    );
};
