import { type ChangeEvent, type ReactElement } from 'react';

import { Settings } from 'lucide-react';

import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { Tooltip, TooltipContent, TooltipTrigger } from '#/components/ui/tooltip';

import {
    AUTO_SAVE_INTERVAL_OPTIONS,
    isAutoSaveIntervalMs,
    type Preferences,
    type SoloModePreference,
} from '../../../models/Preferences';
import { SectionTitle, FieldGroup, ToggleRow, VoiceKeyEditor, GridSubdivisionSection } from '../preferencesShared';

type SectionProps = {
    prefs: Preferences;
    update: (partial: Partial<Preferences>) => void;
};

const AUTO_SAVE_DESCRIPTION_ID = 'auto-save-policy-description';

export const GeneralSection = ({ prefs, update }: SectionProps): ReactElement => {
    const trackHeights: Preferences['trackHeight'][] = ['compact', 'normal', 'large'];
    const handleAutoSaveIntervalChange = (event: ChangeEvent<HTMLSelectElement>): void => {
        const interval = Number(event.target.value);
        if (!isAutoSaveIntervalMs(interval)) {
            return;
        }
        update({ autoSaveIntervalMs: interval });
    };

    return (
        <>
            <SectionTitle icon={<Settings className="size-4" />} title="General" />
            <FieldGroup label="Track Height">
                <Row align="stretch" gap={2}>
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
                </Row>
            </FieldGroup>
            <GridSubdivisionSection
                value={prefs.gridSubdivision}
                onChange={(value) => update({ gridSubdivision: value })}
            />
            <Separator />
            <Stack gap={3}>
                <ToggleRow
                    label="Snap to Grid"
                    value={prefs.snapToGrid}
                    onChange={(value) => update({ snapToGrid: value })}
                />
                <ToggleRow
                    label="Snap to Zero Crossing"
                    value={prefs.snapToZeroCrossing}
                    onChange={(value) => update({ snapToZeroCrossing: value })}
                />
                <Stack gap={2}>
                    <ToggleRow
                        label="Auto Save"
                        value={prefs.autoSave}
                        onChange={(value) => update({ autoSave: value })}
                        descriptionId={AUTO_SAVE_DESCRIPTION_ID}
                    />
                    <DawCompactSelect
                        value={prefs.autoSaveIntervalMs}
                        onChange={handleAutoSaveIntervalChange}
                        className="w-full"
                        aria-label="Auto-save interval"
                        aria-describedby={AUTO_SAVE_DESCRIPTION_ID}
                    >
                        {AUTO_SAVE_INTERVAL_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </DawCompactSelect>
                    <p id={AUTO_SAVE_DESCRIPTION_ID} className="text-[10px] leading-relaxed text-muted-foreground">
                        Auto Save creates a reopenable local project snapshot while playback is stopped. Turning it off
                        stops scheduled snapshots; crash-recovery data still updates in the background.
                    </p>
                </Stack>
                <ToggleRow
                    label="Show Minimap"
                    value={prefs.showMinimap}
                    onChange={(value) => update({ showMinimap: value })}
                />
            </Stack>
            <Separator />
            <FieldGroup label="Metronome">
                <Stack gap={2}>
                    <ToggleRow
                        label="Enabled"
                        value={prefs.metronomeEnabled}
                        onChange={(value) => update({ metronomeEnabled: value })}
                    />
                    {prefs.metronomeEnabled ? (
                        <Stack gap={1}>
                            <label className="text-[10px] text-muted-foreground block">Volume</label>
                            <Slider
                                value={[prefs.metronomeVolume * 100]}
                                onValueChange={([value]) => {
                                    if (value !== undefined) {
                                        update({ metronomeVolume: value / 100 });
                                    }
                                }}
                                max={100}
                                step={1}
                                className="w-full"
                                aria-label="Metronome volume"
                            />
                        </Stack>
                    ) : null}
                </Stack>
            </FieldGroup>
            <Separator />
            <FieldGroup label="Recording">
                <Stack gap={3}>
                    <Stack gap={1}>
                        <label className="text-[10px] text-muted-foreground block">Count-In (bars)</label>
                        <Row align="stretch" gap={1}>
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
                        </Row>
                    </Stack>
                    <Stack gap={1}>
                        <Row justify="between">
                            <span className="text-xs text-foreground">Pre-roll</span>
                            <Button
                                variant={prefs.preRollEnabled ? 'secondary' : 'ghost'}
                                size="xs"
                                onClick={() => update({ preRollEnabled: !prefs.preRollEnabled })}
                            >
                                {prefs.preRollEnabled ? 'On' : 'Off'}
                            </Button>
                        </Row>
                        {prefs.preRollEnabled ? (
                            <Stack gap={1}>
                                <label className="text-[10px] text-muted-foreground block">Pre-roll bars</label>
                                <Row align="stretch" gap={1}>
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
                                </Row>
                            </Stack>
                        ) : null}
                    </Stack>
                </Stack>
            </FieldGroup>
            <Separator />
            <FieldGroup label="Mixer">
                <Stack gap={1}>
                    <label className="text-[10px] text-muted-foreground block">Solo Mode</label>
                    <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">
                        Determines how soloed tracks affect others. SIP (Solo In Place) is standard.
                    </p>
                    <Row align="stretch" gap={1}>
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
                    </Row>
                </Stack>
            </FieldGroup>
            <VoiceKeyEditor currentKey={prefs.voiceCommandKey} onChange={(key) => update({ voiceCommandKey: key })} />
        </>
    );
};
