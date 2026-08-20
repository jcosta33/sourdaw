import { type ReactElement, useState } from 'react';

import { Stack } from '#/components/layout';
import { compileReorderDevicesAction, getPlatformPlugins, selectTrack } from '#/modules/Arrangement/useCases';
import { executeAppAction } from '#/modules/Command/useCases';
import { MIDI_EFFECT_FACTORIES } from '#/modules/MIDI/useCases';
import { openInspector } from '#/modules/WorkspaceShell/useCases';
import { cn } from '#/utils/Styles/cn';

import { type Track } from '../../../models/TrackViewTypes';
import { MixerInsetButton } from '../../components/Mixer/MixerInsetButton';
import { MixerSection } from '../../components/Mixer/MixerSection';

type DeviceChainSectionProps = {
    track: Track;
};

export const DeviceChainSection = ({ track }: DeviceChainSectionProps): ReactElement => {
    const [showAdd, setShowAdd] = useState(false);

    const handleOpenInspector = (): void => {
        selectTrack(track.id);
        openInspector();
    };

    return (
        <MixerSection label="Devices">
            <Stack
                gap={0.5}
                className="max-h-[100px] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10"
            >
                {track.devices.map((data) => (
                    <div key={data.id} className="group relative">
                        <MixerInsetButton
                            className={cn(
                                'cursor-grab active:cursor-grabbing shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]',
                                data.bypassed && 'opacity-40 line-through'
                            )}
                            onClick={(event) => {
                                event.stopPropagation();
                                handleOpenInspector();
                            }}
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                // Route through the action boundary so the
                                // bypass lands in one Automerge transaction
                                // and is undoable — the same mutation issued
                                // by an AI prompt already goes through this
                                // action (#1938 precedent).
                                void executeAppAction({
                                    type: 'bypassDevice',
                                    payload: { deviceId: data.id, bypassed: !data.bypassed },
                                });
                            }}
                            title={`${data.name} — click to inspect, double-click to ${data.bypassed ? 'enable' : 'bypass'}`}
                            draggable
                            onDragStart={(event) => {
                                event.dataTransfer.setData('text/plain', data.id);
                                event.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(event) => {
                                event.preventDefault();
                                const draggedDeviceId = event.dataTransfer.getData('text/plain');
                                const action = compileReorderDevicesAction(track.id, draggedDeviceId, data.id);
                                if (action) {
                                    void executeAppAction(action);
                                }
                            }}
                        >
                            <span className="text-[10px] text-muted-foreground">
                                <span className="text-[9px] text-muted-foreground/50 mr-0.5">≡</span>
                                {data.name}
                            </span>
                        </MixerInsetButton>
                        <button
                            type="button"
                            className="absolute -right-0.5 -top-0.5 hidden size-3.5 items-center justify-center rounded-full bg-destructive/80 text-[10px] text-destructive-foreground hover:bg-destructive group-hover:flex"
                            onClick={(event) => {
                                event.stopPropagation();
                                // Same boundary routing as bypass: the
                                // removeDevice action is undoable (its
                                // restoreDevice inverse snapshots the device).
                                void executeAppAction({
                                    type: 'removeDevice',
                                    payload: { deviceId: data.id },
                                });
                            }}
                            aria-label={`Remove ${data.name}`}
                            title={`Remove ${data.name}`}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </Stack>
            {showAdd ? (
                <Stack gap={0.5}>
                    {getPlatformPlugins().map((param) => (
                        <MixerInsetButton
                            key={param.id}
                            onClick={(event) => {
                                event.stopPropagation();
                                void executeAppAction({
                                    type: 'addDevice',
                                    payload: { trackId: track.id, deviceType: param.id },
                                });
                                setShowAdd(false);
                            }}
                        >
                            + {param.name}
                        </MixerInsetButton>
                    ))}
                    <div
                        className="px-3 py-0.5 text-[10px] text-muted-foreground/60 uppercase tracking-wider mt-0.5"
                        style={{ borderTop: '1px solid rgba(255,255,255,0.04)' }}
                    >
                        MIDI FX
                    </div>
                    {MIDI_EFFECT_FACTORIES.map((fx) => (
                        <MixerInsetButton
                            key={fx.id}
                            tone="accent"
                            onClick={(event) => {
                                event.stopPropagation();
                                void executeAppAction({
                                    type: 'addDevice',
                                    payload: { trackId: track.id, deviceType: fx.name },
                                });
                                setShowAdd(false);
                            }}
                        >
                            ♪ {fx.name}
                        </MixerInsetButton>
                    ))}
                    <button
                        type="button"
                        className="w-full text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(event) => {
                            event.stopPropagation();
                            setShowAdd(false);
                        }}
                    >
                        cancel
                    </button>
                </Stack>
            ) : (
                <MixerInsetButton
                    onClick={(event) => {
                        event.stopPropagation();
                        setShowAdd(true);
                    }}
                >
                    <span className="text-[10px] text-muted-foreground/50">+ add</span>
                </MixerInsetButton>
            )}
        </MixerSection>
    );
};
