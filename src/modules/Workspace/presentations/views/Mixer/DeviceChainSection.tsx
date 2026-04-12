import { type ReactElement, useState } from 'react';
import { cn } from '#/utils/Styles/cn';
import {
    selectTrack,
    bypassDevice,
    addDevice,
    removeDevice,
    reorderDevices,
    getPlatformPlugins,
} from '#/modules/Arrangement/useCases';
import { openInspector } from '../../../useCases/togglePanel/panelToggles/openInspector';
import { type Track } from '../../../models/TrackViewTypes';
import { MIDI_EFFECT_FACTORIES } from '#/modules/Plugin/useCases';
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
            <div className="max-h-[100px] space-y-0.5 overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10">
                {track.devices.map((d, deviceIndex) => (
                    <div key={d.id} className="group relative">
                        <MixerInsetButton
                            className={cn(
                                'cursor-grab active:cursor-grabbing shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)]',
                                d.bypassed && 'opacity-40 line-through'
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                handleOpenInspector();
                            }}
                            onDoubleClick={(e) => {
                                e.stopPropagation();
                                bypassDevice(d.id, !d.bypassed);
                            }}
                            title={`${d.name} — click to inspect, double-click to ${d.bypassed ? 'enable' : 'bypass'}`}
                            draggable
                            onDragStart={(e) => {
                                e.dataTransfer.setData('text/plain', String(deviceIndex));
                                e.dataTransfer.effectAllowed = 'move';
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.dataTransfer.dropEffect = 'move';
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
                                if (!isNaN(fromIndex) && fromIndex !== deviceIndex) {
                                    reorderDevices(track.id, fromIndex, deviceIndex);
                                }
                            }}
                        >
                            <span className="text-[10px] text-muted-foreground">
                                <span className="text-[9px] text-muted-foreground/50 mr-0.5">≡</span>
                                {d.name}
                            </span>
                        </MixerInsetButton>
                        <button
                            type="button"
                            className="absolute -right-0.5 -top-0.5 hidden size-3.5 items-center justify-center rounded-full bg-destructive/80 text-[10px] text-destructive-foreground hover:bg-destructive group-hover:flex"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeDevice(d.id);
                            }}
                            aria-label={`Remove ${d.name}`}
                            title={`Remove ${d.name}`}
                        >
                            ×
                        </button>
                    </div>
                ))}
            </div>
            {showAdd ? (
                <div className="space-y-0.5">
                    {getPlatformPlugins().map((p) => (
                        <MixerInsetButton
                            key={p.id}
                            onClick={(e) => {
                                e.stopPropagation();
                                addDevice(track.id, p.name);
                                setShowAdd(false);
                            }}
                        >
                            + {p.name}
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
                            onClick={(e) => {
                                e.stopPropagation();
                                addDevice(track.id, fx.name);
                                setShowAdd(false);
                            }}
                        >
                            ♪ {fx.name}
                        </MixerInsetButton>
                    ))}
                    <button
                        type="button"
                        className="w-full text-[10px] text-muted-foreground hover:text-foreground"
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowAdd(false);
                        }}
                    >
                        cancel
                    </button>
                </div>
            ) : (
                <MixerInsetButton
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowAdd(true);
                    }}
                >
                    <span className="text-[10px] text-muted-foreground/50">+ add</span>
                </MixerInsetButton>
            )}
        </MixerSection>
    );
};
