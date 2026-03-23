export type { WAMDescriptor, WAMInstance } from './types';
export { initWAMEnvironment, registerWAMPlugin, getRegisteredPlugins, getPluginsByCategory, loadWAMPlugin, unloadWAMPlugin, getActiveInstances } from './hostOperations';
export { registerBuiltinPlugins } from './builtinDescriptors';
