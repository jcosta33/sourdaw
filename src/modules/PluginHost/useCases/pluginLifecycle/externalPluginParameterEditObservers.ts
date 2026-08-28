/**
 * One edit a plugin made to one of its own parameters, as a foreign module reads
 * it.
 *
 * camelCase, and named for the instance rather than the wire: the snake_case DTO
 * stays inside `repositories/pluginBridge`, like every other bridge shape.
 *
 * `value` is present only on a `value` edit. A gesture boundary reports that the
 * user took hold of a control in the plugin's editor or let go of it, and
 * carries no setting.
 */
export type ExternalPluginParameterEdit = {
    instanceId: string;
    parameterId: number;
    kind: 'gestureBegin' | 'value' | 'gestureEnd';
    value?: number;
};

/**
 * Everyone listening for edits a plugin makes to its own parameters.
 *
 * A set rather than one handler because the native event is a broadcast and the
 * consumers are unrelated: the project marks itself dirty, and an automation
 * recorder reads the gesture brackets. Keeping them in one set is what lets a
 * single `plugin-parameter-events` subscription serve all of them —
 * per-consumer subscriptions would each receive every other consumer's edits
 * anyway.
 *
 * Ephemeral runtime state, not project truth.
 */
export const externalPluginParameterEditObservers = new Set<(edit: ExternalPluginParameterEdit) => void>();
