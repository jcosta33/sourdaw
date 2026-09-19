/**
 * Raised when a tool's JSON schema carries a construct a strict-schema projection
 * cannot preserve: an external or recursive `$ref` (Sourdaw tool schemas carry no
 * `$defs` registry to resolve one), or a keyword whose semantics a projection would
 * otherwise have to drop silently.
 */
export class ToolSchemaProjectionError extends Error {
    override readonly name = 'ToolSchemaProjectionError';
    readonly schemaPath: string;

    constructor(schemaPath: string, reason: string) {
        super(`Tool schema at "${schemaPath}" cannot be projected to a strict schema: ${reason}`);
        this.schemaPath = schemaPath;
    }
}

export function isToolSchemaProjectionError(error: unknown): error is ToolSchemaProjectionError {
    return error instanceof Error && error.name === 'ToolSchemaProjectionError';
}
