import { type ReactElement } from 'react';
import { Button } from '#/components/ui/button';
import { ChevronRight, Power } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import { bypassDevice } from '../../../useCases/workspaceViewActions';
import { getSidechainSource, addSidechainRoute, removeSidechainRoute } from '../../../useCases/workspaceViewActions';
import { useTracks } from '../../hooks/useTracks';
import { type Device } from '../../../useCases/workspaceViewActions';
import { DeviceParameterControl } from './DeviceParameterControl';

export type DeviceInspectorProps = {
    device: Device;
    trackId: string;
    onBack: () => void;
};

export const DeviceInspector = ({ device, trackId, onBack }: DeviceInspectorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const plugin = BUILTIN_PLUGINS.find((p) => p.name === device.type || p.name === device.name);
    const parameters = plugin?.parameters ?? [];
    const isSidechainComp =
        device.type?.toLowerCase().includes('sidechain') ?? device.name?.toLowerCase().includes('sidechain');
    const sidechainSource = getSidechainSource(device.id);
    const sourceTracks = allTracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder' && t.id !== trackId);

    return (
        <div className="space-y-4 p-3">
            <div className="flex items-center gap-1">
                <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
                    <ChevronRight className="size-3 rotate-180" />
                </Button>
                <h3 className="text-xs font-medium text-foreground">{device.name}</h3>
                <div className="flex-1" />
                <Button
                    variant="ghost"
                    size="icon-xs"
                    aria-label={device.bypassed ? 'Enable' : 'Bypass'}
                    onClick={() => bypassDevice(device.id, !device.bypassed)}
                >
                    <Power className={`size-3 ${device.bypassed ? 'text-muted-foreground' : 'text-emerald-400'}`} />
                </Button>
            </div>

            {isSidechainComp && (
                <section>
                    <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Sidechain Source
                    </h3>
                    <select
                        className="w-full rounded border border-border bg-background px-2 py-1.5 text-xs"
                        value={sidechainSource?.sourceTrackId ?? ''}
                        onChange={(e) => {
                            const srcId = e.target.value;
                            if (srcId) {
                                addSidechainRoute(srcId, trackId, device.id);
                            } else if (sidechainSource) {
                                removeSidechainRoute(sidechainSource.id);
                            }
                        }}
                    >
                        <option value="">None</option>
                        {sourceTracks.map((t) => (
                            <option key={t.id} value={t.id}>
                                {t.name}
                            </option>
                        ))}
                    </select>
                </section>
            )}

            {parameters.length > 0 ? (
                <section>
                    <h3 className="mb-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                        Parameters
                    </h3>
                    <div className="space-y-3">
                        {parameters.map((param) => (
                            <DeviceParameterControl key={param.id} param={param} device={device} trackId={trackId} />
                        ))}
                    </div>
                </section>
            ) : (
                <p className="text-[10px] text-muted-foreground">No parameters available for this device.</p>
            )}
        </div>
    );
};
