import { type ReactElement, useState } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { selectTrack } from '../../../useCases/workspaceViewActions';
import { bypassDevice, addDevice, removeDevice, reorderDevices } from '../../../useCases/workspaceViewActions';
import { getPlatformPlugins } from '../../../useCases/workspaceViewActions';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { type Track } from '../../../useCases/workspaceViewActions';
import { getAllModulationRoutes } from '#/modules/AudioEngine/useCases/modulationSystem';
import { MIDI_EFFECT_FACTORIES } from '#/modules/AudioEngine/useCases/midiEffectPlugins';

type DeviceChainSectionProps = {
    track: Track;
};

export const DeviceChainSection = ({ track }: DeviceChainSectionProps): ReactElement => {
    const [showAdd, setShowAdd] = useState(false);

    const openInspector = () => {
        selectTrack(track.id);
        const ws = workspaceStore.value;
        if (ws && !ws.inspectorOpen) {
            workspaceStore.set({ ...ws, inspectorOpen: true });
        }
    };

    return (
        <div className="w-full space-y-0.5">
            <label className="text-[10px] text-muted-foreground/60 block text-center uppercase tracking-wider">
                Devices
            </label>
            <div className="max-h-[100px] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10 space-y-0.5">
                {track.devices.map((d, deviceIndex) => (
                    <div key={d.id} className="group relative">
                        <button
                            type="button"
                            className={cn(
                                'w-full rounded bg-surface-inset shadow-[inset_0_1px_2px_rgba(0,0,0,0.4)] border border-border-hairline px-1 py-0.5 text-center hover:bg-surface-raised transition-colors cursor-grab active:cursor-grabbing',
                                d.bypassed && 'opacity-40 line-through'
                            )}
                            onClick={(e) => {
                                e.stopPropagation();
                                openInspector();
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
                                {getAllModulationRoutes().some((r) => r.target.deviceId === d.id) && (
                                    <span
                                        className="ml-0.5 inline-block size-1.5 rounded-full bg-[var(--color-accent-lavender)]"
                                        title="Modulated"
                                    />
                                )}
                            </span>
                        </button>
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
                        <button
                            type="button"
                            key={p.id}
                            className="w-full rounded bg-surface-inset border border-border-hairline shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] px-1 py-0.5 text-center hover:bg-surface-raised text-[10px] text-foreground transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                addDevice(track.id, p.name);
                                setShowAdd(false);
                            }}
                        >
                            + {p.name}
                        </button>
                    ))}
                    <div className="px-3 py-0.5 text-[10px] text-muted-foreground/60 uppercase tracking-wider border-t border-border/20 mt-0.5">
                        MIDI FX
                    </div>
                    {MIDI_EFFECT_FACTORIES.map((fx) => (
                        <button
                            type="button"
                            key={fx.id}
                            className="w-full rounded bg-[var(--color-accent-lavender)]/10 border border-[var(--color-accent-lavender)]/20 px-1 py-0.5 text-center hover:bg-[var(--color-accent-lavender)]/20 text-[10px] text-foreground transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                addDevice(track.id, fx.name);
                                setShowAdd(false);
                            }}
                        >
                            ♪ {fx.name}
                        </button>
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
                <button
                    type="button"
                    className="w-full rounded bg-surface-inset border border-border-hairline shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)] px-1 py-0.5 text-center hover:bg-surface-raised transition-colors"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowAdd(true);
                    }}
                >
                    <span className="text-[10px] text-muted-foreground/50">+ add</span>
                </button>
            )}
        </div>
    );
};
