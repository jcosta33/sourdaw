// Private process-local stream state. It is intentionally not exposed through
// a module contract.
export const activeCloudStreamControllers = new Set<AbortController>();
