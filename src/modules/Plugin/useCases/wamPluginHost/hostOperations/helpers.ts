import { type WAMDescriptor, type WAMInstance } from '../../../models/WamPluginHostTypes';
export type { WAMDescriptor, WAMInstance };

// In-memory registries (raw Map singletons — not Store<T>)
export const registry = new Map<string, WAMDescriptor>();

export const instances = new Map<string, WAMInstance>();