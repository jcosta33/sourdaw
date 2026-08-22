import { useEffect, useState } from 'react';

import { trackStore } from '#/modules/Arrangement/stores';

import { onPanelShowBacteria } from '../../useCases/panels/devicePanels/onPanelShowBacteria';
import { onPanelShowCrumbs } from '../../useCases/panels/devicePanels/onPanelShowCrumbs';
import { onPanelShowCrust } from '../../useCases/panels/devicePanels/onPanelShowCrust';
import { onPanelShowDutchOven } from '../../useCases/panels/devicePanels/onPanelShowDutchOven';
import { onPanelShowFermenter } from '../../useCases/panels/devicePanels/onPanelShowFermenter';
import { onPanelShowGluten } from '../../useCases/panels/devicePanels/onPanelShowGluten';
import { onPanelShowGrandBoule } from '../../useCases/panels/devicePanels/onPanelShowGrandBoule';
import { onPanelShowLevain } from '../../useCases/panels/devicePanels/onPanelShowLevain';
import { onPanelShowProof } from '../../useCases/panels/devicePanels/onPanelShowProof';
import { onPanelShowScoring } from '../../useCases/panels/devicePanels/onPanelShowScoring';
import { onPanelShowToaster } from '../../useCases/panels/devicePanels/onPanelShowToaster';
import { onPanelShowYeast } from '../../useCases/panels/devicePanels/onPanelShowYeast';
import { onShowDevicePanel } from '../../useCases/panels/devicePanels/onShowDevicePanel';

/**
 * Unified active-device-panel state.
 *
 * Only one device panel can be open at a time — opening one must close any
 * other. That invariant is enforced by the type system (single discriminated
 * union) rather than by a hand-written setter chain across N useState slots.
 *
 * Track-scoping invariant: every panel opened while a track is selected
 * captures the owning `trackId` at open time, and the hook subscribes
 * directly to `trackStore`. When the current selection no longer matches the
 * captured `trackId`, the panel is closed. This catches any path that
 * mutates `selectedTrackId`, including code that bypasses `selectTrack`.
 * Panels opened with no active track (e.g. Levain from the sidebar
 * instruments browser, `trackId === null`) stay open across selection
 * changes, matching the "global" opening semantics.
 */
export type ActiveDevicePanel =
    | { kind: 'fermenter'; deviceId: string; trackId: string | null }
    | { kind: 'toaster'; deviceId: string; trackId: string | null }
    | { kind: 'levain'; deviceId: string; trackId: string | null }
    | { kind: 'proofChamber'; deviceId: string; trackId: string | null }
    | { kind: 'gluten'; deviceId: string; trackId: string | null }
    | { kind: 'bacteria'; deviceId: string; trackId: string | null }
    | { kind: 'grinder'; deviceId: string; trackId: string | null }
    | { kind: 'scoring'; deviceId: string; trackId: string | null }
    | { kind: 'proof'; deviceId: string; trackId: string | null }
    | { kind: 'yeast'; deviceId: string | null; trackId: string | null }
    | { kind: 'crust'; deviceId: string; trackId: string | null }
    | { kind: 'sampler'; deviceId: string; trackId: string | null }
    | { kind: 'grandBoule'; deviceId: string; trackId: string | null };

type UseActiveDevicePanelResult = {
    activePanel: ActiveDevicePanel | null;
    closeActivePanel: () => void;
};

export function useActiveDevicePanel(): UseActiveDevicePanelResult {
    const [activePanel, setActivePanel] = useState<ActiveDevicePanel | null>(null);

    useEffect(() => {
        type NeedsDeviceId = Exclude<ActiveDevicePanel, { kind: 'yeast' }>['kind'];
        type DeviceVariant<Kind extends NeedsDeviceId> = Extract<ActiveDevicePanel, { kind: Kind }>;
        const currentTrackId = (): string | null => trackStore.value?.selectedTrackId ?? null;
        // Yeast rack state is per device instance (issue #2422), so the panel
        // must name its device: the event payload's deviceId when the opener
        // knows it, otherwise the selected track's Yeast device. `null` means
        // no instance to bind — the panel falls back to selection itself.
        const yeastDeviceIdForOpen = (deviceId: string | null): string | null => {
            if (deviceId !== null) {
                return deviceId;
            }
            const state = trackStore.value;
            const track = state?.tracks.find((candidate) => candidate.id === state?.selectedTrackId);
            return track?.devices.find((device) => device.type === 'yeast')?.id ?? null;
        };
        // One builder per device-bearing kind. The mapped type forces an entry for
        // every `NeedsDeviceId` (add a kind → missing-key error here), and the
        // `satisfies` on each literal pins it to that kind's exact member shape, so
        // a future deviceId-less variant that slips into `NeedsDeviceId` fails with
        // an excess-property error instead of being silently widened by a cast.
        const devicePanelBuilders: {
            [Kind in NeedsDeviceId]: (deviceId: string) => DeviceVariant<Kind>;
        } = {
            fermenter: (deviceId) =>
                ({ kind: 'fermenter', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'fermenter'>,
            toaster: (deviceId) =>
                ({ kind: 'toaster', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'toaster'>,
            levain: (deviceId) =>
                ({ kind: 'levain', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'levain'>,
            proofChamber: (deviceId) =>
                ({ kind: 'proofChamber', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'proofChamber'>,
            gluten: (deviceId) =>
                ({ kind: 'gluten', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'gluten'>,
            bacteria: (deviceId) =>
                ({ kind: 'bacteria', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'bacteria'>,
            grinder: (deviceId) =>
                ({ kind: 'grinder', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'grinder'>,
            scoring: (deviceId) =>
                ({ kind: 'scoring', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'scoring'>,
            proof: (deviceId) =>
                ({ kind: 'proof', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'proof'>,
            crust: (deviceId) =>
                ({ kind: 'crust', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'crust'>,
            sampler: (deviceId) =>
                ({ kind: 'sampler', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'sampler'>,
            grandBoule: (deviceId) =>
                ({ kind: 'grandBoule', deviceId, trackId: currentTrackId() }) satisfies DeviceVariant<'grandBoule'>,
        };
        const openForKind =
            <Kind extends NeedsDeviceId>(kind: Kind) =>
            (param: { deviceId: string | null }) => {
                if (param.deviceId === null) {
                    setActivePanel(null);
                    return;
                }
                setActivePanel(devicePanelBuilders[kind](param.deviceId));
            };
        const subs = [
            onPanelShowFermenter(openForKind('fermenter')),
            onPanelShowToaster(openForKind('toaster')),
            onPanelShowLevain(openForKind('levain')),
            onPanelShowDutchOven(openForKind('proofChamber')),
            onPanelShowGluten(openForKind('gluten')),
            onPanelShowBacteria(openForKind('bacteria')),
            onShowDevicePanel((payload) => {
                if (payload.deviceType === 'grinder') {
                    openForKind('grinder')({ deviceId: payload.deviceId });
                }
            }),
            onPanelShowProof(openForKind('proof')),
            onPanelShowYeast((payload) =>
                setActivePanel({
                    kind: 'yeast',
                    deviceId: yeastDeviceIdForOpen(payload.deviceId),
                    trackId: currentTrackId(),
                })
            ),
            onPanelShowScoring(openForKind('scoring')),
            onPanelShowCrust(openForKind('crust')),
            onPanelShowCrumbs(openForKind('sampler')),
            onPanelShowGrandBoule(openForKind('grandBoule')),
            trackStore.subscribe((state) => {
                const nextSelected = state?.selectedTrackId ?? null;
                setActivePanel((panel) => {
                    if (panel === null) {
                        return panel;
                    }
                    if (panel.trackId === null) {
                        return panel;
                    }
                    if (panel.trackId === nextSelected) {
                        return panel;
                    }
                    return null;
                });
            }),
        ];
        return () => {
            for (const unsub of subs) {
                unsub();
            }
        };
    }, []);

    const closeActivePanel = (): void => {
        setActivePanel(null);
    };

    return { activePanel, closeActivePanel };
}
