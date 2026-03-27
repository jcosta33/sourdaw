import { type ReactElement } from 'react';
import {
    type DeviceLayoutProps,
    SectionHeader,
    ParamGrid,
    registerDeviceLayout,
} from '../../deviceLayoutRegistry';
import { CompressorGainReduction } from '../../../metering/CompressorGainReduction';
import { CompressorCurve } from '../../../../components/CompressorCurve';
import { getSidechainSource, addSidechainRoute, removeSidechainRoute } from '#/modules/Routing/useCases/sidechain';
import { useTracks } from '../../../../hooks/useTracks';
import { Card } from '#/components/ui/card';

const CompressorLayout = ({ device, trackId, parameters }: DeviceLayoutProps): ReactElement => {
    const { tracks: allTracks } = useTracks();
    const pv = device.parameterValues;
    const isLimiter = false;
    const isSidechainComp =
        device.type?.toLowerCase().includes('sidechain') ?? device.name?.toLowerCase().includes('sidechain');
    const sidechainSource = getSidechainSource(device.id);
    const sourceTracks = allTracks.filter((t) => t.kind !== 'master' && t.kind !== 'folder' && t.id !== trackId);

    return (
        <div className="space-y-3">
            {isSidechainComp ? (
                <div>
                    <SectionHeader title="Sidechain Source" />
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
            ) : null}

            <div>
                <SectionHeader title="Transfer Curve" />
                <div className="flex justify-center">
                    <CompressorCurve
                        threshold={pv['comp-threshold'] ?? -20}
                        ratio={isLimiter ? 20 : (pv['comp-ratio'] ?? 4)}
                        knee={pv['comp-knee'] ?? 6}
                        makeup={pv['comp-makeup'] ?? 0}
                        width={180}
                        height={120}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Gain Reduction" />
                <div className="flex justify-center">
                    <CompressorGainReduction
                        trackId={trackId}
                        threshold={pv['comp-threshold'] ?? -12}
                        ratio={pv['comp-ratio'] ?? 4}
                    />
                </div>
            </div>
            <div>
                <SectionHeader title="Parameters" />
                <ParamGrid params={parameters} device={device} trackId={trackId} />
            </div>
        </div>
    );
};

registerDeviceLayout(['builtin-compressor', 'builtin-sidechain-compressor'], CompressorLayout);
