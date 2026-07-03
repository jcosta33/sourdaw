import { type GrooveTemplate } from '../../models/GrooveTemplate';

/**
 * In-memory registry of grooves extracted at runtime (e.g. via the
 * `extractGroove` action). `extractGroove` mints templates with synthetic ids
 * (`extracted-<clipId>`) that the factory roster does not know about, so
 * without this registry an extracted groove could never be re-applied. Lookups
 * consult this registry first and fall back to the factory grooves, so factory
 * ids keep working unchanged.
 */
export const extractedGrooves = new Map<string, GrooveTemplate>();
