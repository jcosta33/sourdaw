import { type ReactElement, useState } from 'react';
import { cn } from '#/helpers/Styles/cn';
import { selectTrack } from '../../../useCases/workspaceViewActions';
import { bypassDevice, addDevice, removeDevice, reorderDevices } from '../../../useCases/workspaceViewActions';
import { BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import { workspaceStore } from '#/modules/Workspace/stores/workspaceStore';
import { type Track } from '../../../useCases/workspaceViewActions';

export type DeviceChainSectionProps = {
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
            <label className="text-[7px] text-muted-foreground/60 block text-center uppercase tracking-wider">
                Devices
            </label>
            <div className="max-h-[100px] overflow-y-auto overflow-x-hidden scrollbar-thin scrollbar-thumb-white/10 space-y-0.5">
                {track.devices.map((d, deviceIndex) => (
                    <div key={d.id} className="group relative">
                        <button
                            type="button"
                            className={cn(
                                'w-full rounded bg-muted/20 px-1 py-0.5 text-center hover:bg-muted/40 transition-colors cursor-grab active:cursor-grabbing',
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
                            <span className="text-[7px] text-muted-foreground">
                                <span className="text-[6px] text-muted-foreground/50 mr-0.5">≡</span>
                                {d.name}
                            </span>
                        </button>
                        <button
                            type="button"
                            className="absolute -right-0.5 -top-0.5 hidden size-3.5 items-center justify-center rounded-full bg-destructive/80 text-[8px] text-destructive-foreground hover:bg-destructive group-hover:flex"
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
                    {BUILTIN_PLUGINS.map((p) => (
                        <button
                            type="button"
                            key={p.id}
                            className="w-full rounded bg-primary/10 px-1 py-0.5 text-center hover:bg-primary/20 text-[7px] text-foreground transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                addDevice(track.id, p.name);
                                setShowAdd(false);
                            }}
                        >
                            + {p.name}
                        </button>
                    ))}
                    <button
                        type="button"
                        className="w-full text-[7px] text-muted-foreground hover:text-foreground"
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
                    className="w-full rounded bg-muted/10 px-1 py-0.5 text-center hover:bg-muted/20 transition-colors"
                    onClick={(e) => {
                        e.stopPropagation();
                        setShowAdd(true);
                    }}
                >
                    <span className="text-[7px] text-muted-foreground/50">+ add</span>
                </button>
            )}
        </div>
    );
};
