export type { WAMDescriptor, WAMInstance } from '#/modules/Plugin/models/WamPluginHostTypes';
export { initWAMEnvironment, registerWAMPlugin, getRegisteredPlugins, getPluginsByCategory, loadWAMPlugin, unloadWAMPlugin, getActiveInstances } from './hostOperations';
export { registerBuiltinPlugins } from './builtinDescriptors';
