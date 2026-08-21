import { type ReactElement, useState } from 'react';

import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Row, Stack } from '#/components/layout';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import {
    trimClipStart,
    trimClipEnd,
    setClipFade,
    setClipGain,
    setClipColor,
    renameClip,
    setClipFollowAction,
} from '#/modules/Arrangement/useCases';
import { CLIP_COLOR_PRESETS } from '#/utils/UI/colorPresets';

import { type Clip, type FollowAction } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { InspectorDetailHeader } from '../../components/Inspector/InspectorDetailHeader';

import { ClipAudioAiSection } from './ClipAudioAiSection';
import { ClipGainEnvelopeSection } from './ClipGainEnvelopeSection';
import { ClipMidiAiSection } from './ClipMidiAiSection';

type ClipInspectorProps = {
    clip: Clip;
    trackId: string;
    onBack: () => void;
};

export const ClipInspector = ({ clip, trackId, onBack }: ClipInspectorProps): ReactElement => {
    const duration = clip.endBeat - clip.startBeat;
    const startBar = Math.floor(clip.startBeat / 4) + 1;
    const endBar = Math.floor(clip.endBeat / 4) + 1;
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(clip.name);

    const commitClipName = (): void => {
        const trimmed = nameValue.trim();
        if (trimmed && trimmed !== clip.name) {
            renameClip(clip.id, trimmed);
        }
        setEditingName(false);
    };

    return (
        <Stack gap={4} className="p-3">
            <InspectorDetailHeader
                title={
                    editingName ? (
                        <DawCompactInput
                            value={nameValue}
                            onChange={(event) => setNameValue(event.target.value)}
                            onBlur={commitClipName}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    commitClipName();
                                }
                                if (event.key === 'Escape') {
                                    setNameValue(clip.name);
                                    setEditingName(false);
                                }
                            }}
                            size="micro"
                            className="w-full"
                            aria-label={`Rename clip ${clip.name}`}
                            autoFocus
                        />
                    ) : (
                        <h3
                            className="cursor-pointer truncate text-xs font-medium text-foreground hover:underline"
                            onDoubleClick={() => {
                                setNameValue(clip.name);
                                setEditingName(true);
                            }}
                            title="Double-click to rename"
                        >
                            {clip.name}
                        </h3>
                    )
                }
                onBack={onBack}
                backLabel="Back to track"
            />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Position" />
                <InsetPanel className="space-y-1.5">
                    <DawReadoutRow
                        label="Start"
                        value={`Bar ${startBar} (beat ${clip.startBeat})`}
                        valueClassName="text-foreground"
                    />
                    <DawReadoutRow
                        label="End"
                        value={`Bar ${endBar} (beat ${clip.endBeat})`}
                        valueClassName="text-foreground"
                    />
                    <DawReadoutRow
                        label="Length"
                        value={`${duration} beats (${(duration / 4).toFixed(1)} bars)`}
                        valueClassName="text-foreground"
                    />
                </InsetPanel>
            </section>
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Trim" />
                <Stack gap={2}>
                    <div>
                        <ControlHeader className="mb-1" label="Trim Start" />
                        <Slider
                            value={[clip.startBeat]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    trimClipStart(clip.id, value);
                                }
                            }}
                            max={clip.endBeat - 1}
                            step={0.25}
                            aria-label="Trim clip start"
                        />
                    </div>
                    <div>
                        <ControlHeader className="mb-1" label="Trim End" />
                        <Slider
                            value={[clip.endBeat]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    trimClipEnd(clip.id, value);
                                }
                            }}
                            min={clip.startBeat + 1}
                            max={clip.startBeat + 256}
                            step={0.25}
                            aria-label="Trim clip end"
                        />
                    </div>
                </Stack>
            </section>
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Fades" />
                <Stack gap={2}>
                    <div>
                        <ControlHeader
                            className="mb-1"
                            label="Fade In"
                            value={`${clip.fadeInBeats.toFixed(2)} beats`}
                            valueClassName="text-foreground"
                        />
                        <Slider
                            value={[clip.fadeInBeats]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    setClipFade(clip.id, value, clip.fadeOutBeats);
                                }
                            }}
                            max={duration / 2}
                            step={0.25}
                            aria-label="Fade in duration"
                        />
                    </div>
                    <div>
                        <ControlHeader
                            className="mb-1"
                            label="Fade Out"
                            value={`${clip.fadeOutBeats.toFixed(2)} beats`}
                            valueClassName="text-foreground"
                        />
                        <Slider
                            value={[clip.fadeOutBeats]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    setClipFade(clip.id, clip.fadeInBeats, value);
                                }
                            }}
                            max={duration / 2}
                            step={0.25}
                            aria-label="Fade out duration"
                        />
                    </div>
                </Stack>
            </section>
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Gain" />
                <div>
                    <ControlHeader className="mb-1" label="Clip Gain" value={`${(clip.gain * 100).toFixed(0)}%`} />
                    <Slider
                        value={[clip.gain * 100]}
                        onValueChange={([value]) => {
                            if (value !== undefined) {
                                setClipGain(clip.id, value / 100);
                            }
                        }}
                        max={200}
                        step={1}
                        aria-label="Clip gain"
                    />
                </div>
            </section>
            <Separator />
            <ClipGainEnvelopeSection clipId={clip.id} duration={duration} />
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Color" />
                <Row align="stretch" gap={1}>
                    {CLIP_COLOR_PRESETS.map((context) => (
                        <button
                            type="button"
                            key={context || 'default'}
                            className="size-4 rounded-full border border-border/50 hover:ring-1 hover:ring-foreground/30"
                            style={{
                                backgroundColor: context || 'var(--color-muted)',
                                outline: context === clip.color ? '2px solid white' : 'none',
                                outlineOffset: '1px',
                            }}
                            onClick={() => setClipColor(clip.id, context)}
                            aria-label={context || 'Default color'}
                        />
                    ))}
                </Row>
            </section>
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Properties" />
                <InsetPanel className="space-y-1.5">
                    <DawReadoutRow label="Type" value={clip.type} valueClassName="text-foreground capitalize" />
                    <DawReadoutRow label="Track" value={clip.trackId} valueClassName="text-foreground" />
                    <Row justify="between">
                        <label className="text-[10px] text-muted-foreground" htmlFor="follow-action-select">
                            Follow Action
                        </label>
                        <DawCompactSelect
                            id="follow-action-select"
                            size="micro"
                            align="right"
                            className="border-border-hairline py-0.5 text-[10px]"
                            value={clip.followAction ?? 'none'}
                            onChange={(event) => {
                                const val =
                                    event.target.value === 'none' ? undefined : (event.target.value as FollowAction);
                                setClipFollowAction(clip.id, val);
                            }}
                        >
                            <option className="bg-bg-overlay" value="none">
                                None
                            </option>
                            <option className="bg-bg-overlay" value="stop">
                                Stop
                            </option>
                            <option className="bg-bg-overlay" value="play_next">
                                Play Next
                            </option>
                            <option className="bg-bg-overlay" value="play_previous">
                                Play Previous
                            </option>
                            <option className="bg-bg-overlay" value="play_first">
                                Play First
                            </option>
                            <option className="bg-bg-overlay" value="play_last">
                                Play Last
                            </option>
                            <option className="bg-bg-overlay" value="play_random">
                                Play Random
                            </option>
                        </DawCompactSelect>
                    </Row>
                    {clip.type === 'audio' ? (
                        <DawReadoutRow
                            label="Audio Source"
                            value={clip.audioBufferId ? `${clip.audioBufferId.slice(0, 16)}…` : 'none'}
                            valueClassName="max-w-24 truncate text-foreground"
                        />
                    ) : null}
                </InsetPanel>
            </section>
            {clip.type === 'audio' ? (
                <>
                    <Separator />
                    <ClipAudioAiSection clip={clip} trackId={trackId} />
                </>
            ) : null}
            {clip.type === 'midi' ? (
                <>
                    <Separator />
                    <ClipMidiAiSection clip={clip} />
                </>
            ) : null}
        </Stack>
    );
};
