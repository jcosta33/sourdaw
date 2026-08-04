import { type getTrackStrip } from '#/modules/AudioEngine/useCases';

/**
 * The live strip and device-node shapes, taken from the engine accessor that
 * produces them rather than re-declared structurally. A hand-written stand-in
 * is what hid the bug this selector exists to prevent: it declared `deviceId`
 * optional, while `BuiltinDeviceNode.deviceId` is required, so a selector that
 * ignored the id looked reasonable against the type as well as the fixtures.
 * `AudioEngine/models/` is a private folder, so the type is derived from the
 * `useCases` barrel export instead of deep-imported.
 */
export type ToasterStrip = NonNullable<ReturnType<typeof getTrackStrip>>;
export type ToasterStripDeviceNode = ToasterStrip['deviceNodes'][number];

type FindToasterNodeOnStripInput = {
    strip: ToasterStrip;
    deviceId: string;
};

/**
 * Pick the Toaster node belonging to *this* device.
 *
 * A track can host more than one Toaster. Every caller has the `deviceId` in
 * hand and must use it: taking the first node that exposes toaster controls
 * routes instance B's edits onto instance A's worklet.
 *
 * Scoping is the only decision made here. Readiness is deliberately left to the
 * caller, because the right answer differs by write — see
 * `findReadyToasterControlsOnStrip` for the pad-param side and
 * `setToasterKitParam` for the kit side.
 */
export function findToasterNodeOnStrip({
    strip,
    deviceId,
}: FindToasterNodeOnStripInput): ToasterStripDeviceNode | null {
    const node = strip.deviceNodes.find((candidate) => candidate.deviceId === deviceId && candidate.toasterControls);
    return node ?? null;
}
