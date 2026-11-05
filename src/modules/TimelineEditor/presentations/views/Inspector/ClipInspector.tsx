import { type ReactElement, useEffect, useRef, useState } from 'react';

import { DawCompactCheckbox } from '#/components/daw/DawCompactCheckbox';
import { DawCompactInput } from '#/components/daw/DawCompactInput';
import { DawCompactSelect } from '#/components/daw/DawCompactSelect';
import { DawHeaderBand } from '#/components/daw/DawHeaderBand';
import { DawReadoutRow } from '#/components/daw/DawReadoutRow';
import { Row, Stack } from '#/components/layout';
import { Button } from '#/components/ui/button';
import { Separator } from '#/components/ui/separator';
import { Slider } from '#/components/ui/slider';
import { useStore } from '#/infra/store/useStore';
import { getClipEndLimit, setClipColor, renameClip, setClipFollowAction } from '#/modules/Arrangement/useCases';
import { executeUserAppAction } from '#/modules/Command/useCases';
import { defaultTransportState, timeSignatureMapStore, transportStore } from '#/modules/Transport/stores';
import { formatMusicalLength, formatMusicalPosition } from '#/modules/Transport/useCases';
import { dbToGain, formatGainDb, gainToDb, SEND_MIN_DB } from '#/utils/audioLevelLaw';
import { CLIP_COLOR_PRESETS } from '#/utils/UI/colorPresets';

import { type Clip, type FollowAction, type StretchMode } from '../../../models/TrackViewTypes';
import { ControlHeader } from '../../components/Inspector/ControlHeader';
import { InsetPanel } from '../../components/Inspector/InsetPanel';
import { InspectorDetailHeader } from '../../components/Inspector/InspectorDetailHeader';

import { ClipAudioAiSection } from './ClipAudioAiSection';
import { ClipGainEnvelopeSection } from './ClipGainEnvelopeSection';
import { ClipMidiAiSection } from './ClipMidiAiSection';

/**
 * The gain slider travels in decibels: the floor is the effectively-silent
 * -60 dB (and commits as a hard 0, the way a closed send does), the ceiling is
 * `clampClipGain`'s gain-2 cap so the whole legal range is reachable.
 */
const CLIP_GAIN_MIN_DB = SEND_MIN_DB;
const CLIP_GAIN_MAX_DB = gainToDb(2);

function parseGainDbText(text: string): number | null {
    const trimmed = text.trim().toLowerCase();
    if (trimmed === '-inf' || trimmed === '-infinity' || trimmed === '-∞') {
        return Number.NEGATIVE_INFINITY;
    }
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
}

const EMPTY_METER_MAP = { changes: [] };

/** An uncommitted fade drag, with the stored fade it moved away from. */
type FadeDrag = { from: number; value: number };

/**
 * A drag shows only while the clip still holds the fade it started from. Radix
 * commits nothing for a drag that ends where it began, so its value outlives the
 * gesture, and an undo or collaborator edit after it must show through.
 */
function shownFade(drag: FadeDrag | null, stored: number): number {
    return drag !== null && drag.from === stored ? drag.value : stored;
}

type ClipInspectorProps = {
    clip: Clip;
    trackId: string;
    onBack: () => void;
};

export const ClipInspector = ({ clip, trackId, onBack }: ClipInspectorProps): ReactElement => {
    const duration = clip.endBeat - clip.startBeat;
    const transport = useStore(transportStore, defaultTransportState);
    const meterMap = useStore(timeSignatureMapStore, EMPTY_METER_MAP);
    const meter = {
        changes: meterMap.changes,
        defaultNumerator: transport.timeSignatureNumerator,
        defaultDenominator: transport.timeSignatureDenominator,
    };
    const [editingName, setEditingName] = useState(false);
    const [nameValue, setNameValue] = useState(clip.name);

    const commitClipName = (): void => {
        const trimmed = nameValue.trim();
        if (trimmed && trimmed !== clip.name) {
            renameClip(clip.id, trimmed);
        }
        setEditingName(false);
    };

    // Trim edits commit one undoable action per gesture, the same contract
    // as the gain slider and a timeline drag: the drag only moves local
    // thumb state — the store does not react mid-gesture — and the commit
    // dispatches the registered trim action once with the committed value.
    // A commit landing on the clip's current bound (an unchanged numeric
    // edit) dispatches nothing, so it consumes no undo step.
    const [trimStartDrag, setTrimStartDrag] = useState<number | null>(null);
    const [trimEndDrag, setTrimEndDrag] = useState<number | null>(null);

    const commitTrimStart = (beat: number): void => {
        setTrimStartDrag(null);
        if (beat === clip.startBeat) {
            return;
        }
        void executeUserAppAction({
            type: 'trimClipStart',
            payload: { clipId: clip.id, newStartBeat: beat },
        });
    };

    const trimEndMaxBeat = Math.min(clip.startBeat + 256, getClipEndLimit(clip.id) ?? Number.POSITIVE_INFINITY);

    const commitTrimEnd = (beat: number): void => {
        setTrimEndDrag(null);
        if (beat === clip.endBeat) {
            return;
        }
        void executeUserAppAction({
            type: 'trimClipEnd',
            payload: { clipId: clip.id, newEndBeat: beat },
        });
    };

    // MIDI playback reads neither fades nor a gain envelope, so only audio
    // clips offer them. A fade edit is one undoable action per gesture: the
    // drag holds local thumb state and the commit dispatches once, guarded on
    // the fades the gesture started from (the store does not move mid-drag).
    const isAudioClip = clip.type === 'audio';
    const [fadeInDrag, setFadeInDrag] = useState<FadeDrag | null>(null);
    const [fadeOutDrag, setFadeOutDrag] = useState<FadeDrag | null>(null);
    const shownFadeIn = shownFade(fadeInDrag, clip.fadeInBeats);
    const shownFadeOut = shownFade(fadeOutDrag, clip.fadeOutBeats);

    const commitFade = (fadeInBeats: number, fadeOutBeats: number): void => {
        setFadeInDrag(null);
        setFadeOutDrag(null);
        if (fadeInBeats === clip.fadeInBeats && fadeOutBeats === clip.fadeOutBeats) {
            return;
        }
        void executeUserAppAction({
            type: 'setClipFade',
            payload: {
                clipId: clip.id,
                fadeInBeats,
                fadeOutBeats,
                expectedFadeInBeats: clip.fadeInBeats,
                expectedFadeOutBeats: clip.fadeOutBeats,
            },
        });
    };

    // Clip gain edits are one undoable action per gesture. The drag never
    // writes the store (scheduled clips would not react mid-playthrough anyway,
    // and per-tick writes would churn project truth), so the gesture start is
    // still the live gain at commit time and can anchor the write's
    // compensable expectedGain.
    const [gainDragDb, setGainDragDb] = useState<number | null>(null);
    const gainGestureStart = useRef<number | null>(null);
    const [gainText, setGainText] = useState<string | null>(null);
    const [fineGainStep, setFineGainStep] = useState(false);

    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Shift') {
                setFineGainStep(true);
            }
        };
        const onKeyUp = (event: KeyboardEvent) => {
            if (event.key === 'Shift') {
                setFineGainStep(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp);
        return () => {
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp);
        };
    }, []);

    const clipGainDb = clip.gain <= 0 ? CLIP_GAIN_MIN_DB : gainToDb(clip.gain);

    const commitClipGain = (db: number): void => {
        const gestureStart = gainGestureStart.current ?? clip.gain;
        gainGestureStart.current = null;
        setGainDragDb(null);
        const gain = db <= CLIP_GAIN_MIN_DB ? 0 : dbToGain(db);
        if (gain === gestureStart) {
            return;
        }
        void executeUserAppAction({
            type: 'setClipGain',
            payload: { clipId: clip.id, gain, expectedGain: gestureStart },
        });
    };

    const commitGainText = (): void => {
        if (gainText === null) {
            return;
        }
        const parsed = parseGainDbText(gainText);
        setGainText(null);
        if (parsed === null) {
            return;
        }
        commitClipGain(parsed);
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
                        value={formatMusicalPosition({ ...meter, beat: clip.startBeat })}
                        valueClassName="text-foreground"
                    />
                    <DawReadoutRow
                        label="End"
                        value={formatMusicalPosition({ ...meter, beat: clip.endBeat })}
                        valueClassName="text-foreground"
                    />
                    <DawReadoutRow
                        label="Length"
                        value={formatMusicalLength({ ...meter, startBeat: clip.startBeat, lengthBeats: duration })}
                        valueClassName="text-foreground"
                    />
                </InsetPanel>
            </section>
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Trim" />
                <Stack gap={2}>
                    {/* Trim edits dispatch the registered trim actions rather
                        than the use cases directly, so undo history and the
                        handlers' inverse capture see the same edit as a
                        timeline drag. */}
                    <div>
                        <ControlHeader className="mb-1" label="Trim Start" />
                        <Slider
                            value={[trimStartDrag ?? clip.startBeat]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    setTrimStartDrag(value);
                                }
                            }}
                            onValueCommit={([value]) => {
                                if (value !== undefined) {
                                    commitTrimStart(value);
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
                            value={[trimEndDrag ?? clip.endBeat]}
                            onValueChange={([value]) => {
                                if (value !== undefined) {
                                    setTrimEndDrag(value);
                                }
                            }}
                            onValueCommit={([value]) => {
                                if (value !== undefined) {
                                    commitTrimEnd(value);
                                }
                            }}
                            min={Math.min(clip.startBeat + 1, trimEndMaxBeat)}
                            max={trimEndMaxBeat}
                            step={0.25}
                            aria-label="Trim clip end"
                        />
                    </div>
                </Stack>
            </section>
            {isAudioClip ? (
                <>
                    <Separator />
                    <section>
                        <DawHeaderBand compact className="mb-2 rounded-sm" title="Fades" />
                        <Stack gap={2}>
                            <div>
                                <ControlHeader
                                    className="mb-1"
                                    label="Fade In"
                                    value={`${shownFadeIn.toFixed(2)} beats`}
                                    valueClassName="text-foreground"
                                />
                                <Slider
                                    value={[shownFadeIn]}
                                    onValueChange={([value]) => {
                                        if (value !== undefined) {
                                            setFadeInDrag({ from: clip.fadeInBeats, value });
                                        }
                                    }}
                                    onValueCommit={([value]) => {
                                        if (value !== undefined) {
                                            commitFade(value, clip.fadeOutBeats);
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
                                    value={`${shownFadeOut.toFixed(2)} beats`}
                                    valueClassName="text-foreground"
                                />
                                <Slider
                                    value={[shownFadeOut]}
                                    onValueChange={([value]) => {
                                        if (value !== undefined) {
                                            setFadeOutDrag({ from: clip.fadeOutBeats, value });
                                        }
                                    }}
                                    onValueCommit={([value]) => {
                                        if (value !== undefined) {
                                            commitFade(clip.fadeInBeats, value);
                                        }
                                    }}
                                    max={duration / 2}
                                    step={0.25}
                                    aria-label="Fade out duration"
                                />
                            </div>
                        </Stack>
                    </section>
                </>
            ) : null}
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Gain" />
                <div>
                    <ControlHeader
                        className="mb-1"
                        label="Clip Gain"
                        value={gainDragDb === null ? `${formatGainDb(clip.gain)} dB` : `${gainDragDb.toFixed(1)} dB`}
                        valueClassName="text-foreground"
                    />
                    <Row align="center" gap={2}>
                        <div className="grow">
                            <Slider
                                value={[gainDragDb ?? clipGainDb]}
                                onValueChange={([value]) => {
                                    if (value === undefined) {
                                        return;
                                    }
                                    if (gainGestureStart.current === null) {
                                        gainGestureStart.current = clip.gain;
                                    }
                                    setGainDragDb(value);
                                }}
                                onValueCommit={([value]) => {
                                    if (value !== undefined) {
                                        commitClipGain(value);
                                    }
                                }}
                                min={CLIP_GAIN_MIN_DB}
                                max={CLIP_GAIN_MAX_DB}
                                step={fineGainStep ? 0.1 : 1}
                                aria-label="Clip gain"
                            />
                        </div>
                        <DawCompactInput
                            value={gainText ?? formatGainDb(clip.gain)}
                            onChange={(event) => setGainText(event.target.value)}
                            onBlur={commitGainText}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                    commitGainText();
                                }
                                if (event.key === 'Escape') {
                                    setGainText(null);
                                }
                            }}
                            size="micro"
                            className="w-14"
                            aria-label="Clip gain value"
                        />
                    </Row>
                </div>
            </section>
            {isAudioClip ? (
                <>
                    <Separator />
                    <ClipGainEnvelopeSection clipId={clip.id} duration={duration} />
                </>
            ) : null}
            <Separator />
            <section>
                <DawHeaderBand compact className="mb-2 rounded-sm" title="Color" />
                <Row align="stretch" gap={1}>
                    {CLIP_COLOR_PRESETS.map((context) => (
                        <Button
                            variant="bare"
                            size="bare"
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
                    <Row justify="between">
                        <label className="text-[10px] text-muted-foreground" htmlFor="clip-muted-checkbox">
                            Muted
                        </label>
                        <DawCompactCheckbox
                            id="clip-muted-checkbox"
                            checked={clip.muted ?? false}
                            onChange={(event) => {
                                void executeUserAppAction({
                                    type: 'muteClip',
                                    payload: {
                                        clipId: clip.id,
                                        muted: event.target.checked,
                                    },
                                });
                            }}
                            aria-label="Mute clip"
                        />
                    </Row>
                    <Row justify="between">
                        <label className="text-[10px] text-muted-foreground" htmlFor="clip-locked-checkbox">
                            Locked
                        </label>
                        <DawCompactCheckbox
                            id="clip-locked-checkbox"
                            checked={clip.locked ?? false}
                            onChange={(event) => {
                                void executeUserAppAction({
                                    type: 'lockClip',
                                    payload: {
                                        clipId: clip.id,
                                        locked: event.target.checked,
                                    },
                                });
                            }}
                            aria-label="Lock clip"
                        />
                    </Row>
                    {clip.type === 'audio' ? (
                        <>
                            <DawReadoutRow
                                label="Audio Source"
                                value={clip.audioBufferId ? `${clip.audioBufferId.slice(0, 16)}…` : 'none'}
                                valueClassName="max-w-24 truncate text-foreground"
                            />
                            <Row justify="between">
                                <label className="text-[10px] text-muted-foreground" htmlFor="stretch-mode-select">
                                    Time Stretch
                                </label>
                                <DawCompactSelect
                                    id="stretch-mode-select"
                                    size="micro"
                                    align="right"
                                    className="border-border-hairline py-0.5 text-[10px]"
                                    value={clip.stretchMode ?? 'off'}
                                    onChange={(event) => {
                                        void executeUserAppAction({
                                            type: 'setClipStretchMode',
                                            payload: {
                                                clipId: clip.id,
                                                mode: event.target.value as StretchMode,
                                            },
                                        });
                                    }}
                                >
                                    <option className="bg-bg-overlay" value="off">
                                        Off
                                    </option>
                                    <option className="bg-bg-overlay" value="repitch">
                                        Repitch
                                    </option>
                                    <option className="bg-bg-overlay" value="timestretch">
                                        Timestretch
                                    </option>
                                </DawCompactSelect>
                            </Row>
                        </>
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
