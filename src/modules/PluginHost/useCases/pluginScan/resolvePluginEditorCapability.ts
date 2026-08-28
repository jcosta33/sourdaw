/**
 * What the scan registry knows about a plugin's own editor.
 *
 * Three answers rather than two, because "the scanner did not ask" is not the
 * same statement as "this plugin has no editor", and a control that treats them
 * alike hides an editor the plugin actually has.
 */
export type PluginEditorCapability = 'available' | 'absent' | 'unknown';

/**
 * The scan-registry fields that decide the answer. A partial shape on purpose:
 * a caller reading a registry entry restored from an older build may hold
 * neither field, and that is exactly the `unknown` case.
 */
export type PluginEditorCapabilitySource = {
    has_custom_ui?: boolean;
    capability_metadata_reason?: string;
};

/**
 * Resolve whether a scanned plugin offers its own editor.
 *
 * Only a queried `false` is `absent` — a `false` sitting beside a
 * `capability_metadata_reason` may be an unqueried default, and the reason does
 * not always name which fields it covers in a form this side can rely on. When
 * the two readings disagree this returns `unknown`, which shows the control and
 * lets the open attempt answer for itself: a refusal the user can see beats an
 * editor silently made unreachable.
 *
 * A missing entry is `unknown` for the same reason. Read at render time rather
 * than recorded on the device, so a plugin rescanned after an upgrade that added
 * an editor is offered one without the project having to be rewritten.
 */
export function resolvePluginEditorCapability(
    scanned: PluginEditorCapabilitySource | undefined
): PluginEditorCapability {
    if (scanned?.has_custom_ui === true) {
        return 'available';
    }
    if (scanned?.has_custom_ui === false && scanned.capability_metadata_reason === undefined) {
        return 'absent';
    }
    return 'unknown';
}
