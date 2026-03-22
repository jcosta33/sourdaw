import { type ReactElement } from 'react';
import { Card } from '#/components/ui/card';
import { Button } from '#/components/ui/button';
import { ChevronRight } from 'lucide-react';
import { BUILTIN_PLUGINS } from '../../../useCases/workspaceViewActions';
import { bypassDevice } from '../../../useCases/workspaceViewActions';
import { MechanicalSwitch } from '#/components/daw/MechanicalSwitch';
import { getSidechainSource, addSidechainRoute, removeSidechainRoute } from '../../../useCases/workspaceViewActions';
import { useTracks } from '../../hooks/useTracks';
import { type Device } from '../../../useCases/workspaceViewActions';
import { DeviceParameterControl } from './DeviceParameterControl';
import { CompressorGainReduction } from '../../components/CompressorGainReduction';

type DeviceInspectorProps = {
    device: Device;
    trackId: string;
    onBack: () => void;
};

export const DeviceInspector = ({ device, trackId, onBack }: DeviceInspectorProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const plugin = BUILTIN_PLUGINS.find(
        (p) =>
            p.id === device.type ||
            p.id === `builtin-${device.type}` ||
            p.name.toLowerCase() === device.type?.toLowerCase() ||
            p.name === device.name
    );
    const parameters = plugin?.parameters ?? [];
    const isSidechainComp =
        device.type?.toLowerCase().includes('sidechain') ?? device.name?.toLowerCase().includes('sidechain');
    const isCompressorLimiter =
        device.type?.toLowerCase().includes('compressor') ||
        device.type?.toLowerCase().includes('limiter') ||
        device.name?.toLowerCase().includes('compressor') ||
        device.name?.toLowerCase().includes('limiter') ||
        isSidechainComp;
    const sidechainSource = getSidechainSource(device.id);
    const sourceTracks = allTracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder' && t.id !== trackId);

    return (
        <div className="space-y-4 p-3">
            <div className="flex flex-row items-center justify-between mb-4">
                <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon-xs" onClick={onBack} aria-label="Back to track">
                        <ChevronRight className="size-3 rotate-180" />
                    </Button>
                    <h3 className="text-xs font-medium text-foreground">{device.name}</h3>
                </div>
                <MechanicalSwitch checked={!device.bypassed} onChange={(c) => bypassDevice(device.id, !c)} size="sm" />
            </div>

            {isSidechainComp && (
                <div>
                    <div className="px-1 mb-2 border-b border-border-hairline pb-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Sidechain Source
                        </div>
                    </div>
                    <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                        <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2">
                            <select
                                className="w-full rounded border border-border bg-surface-overlay px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
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
                        </Card>
                    </div>
                </div>
            )}

            {isCompressorLimiter && (
                <div>
                    <div className="px-1 mb-2 border-b border-border-hairline pb-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Gain Reduction
                        </div>
                    </div>
                    <div className="flex justify-center">
                        <CompressorGainReduction
                            trackId={trackId}
                            threshold={device.parameterValues?.threshold ?? -12}
                            ratio={device.parameterValues?.ratio ?? 4}
                        />
                    </div>
                </div>
            )}

            {plugin?.id === 'builtin-eq' && parameters.length > 0 ? (
                <div>
                    <div className="px-1 mb-2 border-b border-border-hairline pb-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            EQ Graphic
                        </div>
                    </div>
                    <div className="grid grid-cols-1 @md:grid-cols-3 gap-2">
                        {/* Low Band */}
                        <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex flex-col items-center gap-1">
                            <span className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">Low</span>
                            <div className="w-full space-y-4">
                                {parameters
                                    .filter((p) => p.name.includes('Low'))
                                    .map((param) => (
                                        <DeviceParameterControl
                                            key={param.id}
                                            param={param}
                                            device={device}
                                            trackId={trackId}
                                        />
                                    ))}
                            </div>
                        </Card>
                        {/* Mid Band */}
                        <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex flex-col items-center gap-1">
                            <span className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">Mid</span>
                            <div className="w-full space-y-4">
                                {parameters
                                    .filter((p) => p.name.includes('Mid'))
                                    .map((param) => (
                                        <DeviceParameterControl
                                            key={param.id}
                                            param={param}
                                            device={device}
                                            trackId={trackId}
                                        />
                                    ))}
                            </div>
                        </Card>
                        {/* High Band */}
                        <Card className="rounded-md shadow-none bg-surface-base border-border/50 p-2 flex flex-col items-center gap-1">
                            <span className="text-[9px] text-muted-foreground font-semibold uppercase mb-2">High</span>
                            <div className="w-full space-y-4">
                                {parameters
                                    .filter((p) => p.name.includes('High'))
                                    .map((param) => (
                                        <DeviceParameterControl
                                            key={param.id}
                                            param={param}
                                            device={device}
                                            trackId={trackId}
                                        />
                                    ))}
                            </div>
                        </Card>
                    </div>
                </div>
            ) : parameters.length > 0 ? (
                <div>
                    <div className="px-1 mb-2 border-b border-border-hairline pb-1">
                        <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                            Parameters
                        </div>
                    </div>
                    <div className="grid grid-cols-1 @md:grid-cols-2 gap-2">
                        {parameters.map((param) => (
                            <Card
                                key={param.id}
                                className="rounded-md shadow-none bg-surface-base border-border/50 p-3 w-full pb-4"
                            >
                                <DeviceParameterControl param={param} device={device} trackId={trackId} />
                            </Card>
                        ))}
                    </div>
                </div>
            ) : (
                <div className="px-1">
                    <p className="text-[10px] text-muted-foreground">No parameters available for this device.</p>
                </div>
            )}
        </div>
    );
};
