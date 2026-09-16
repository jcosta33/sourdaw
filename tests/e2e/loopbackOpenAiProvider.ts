/**
 * The loopback provider lives in `scripts/` because the packaged-Electron
 * proof (`scripts/proveDesktopAgentWorkspace.ts`) starts the same endpoint
 * in-process, and two copies of an admitted provider would let the browser
 * and desktop proofs drift onto different endpoints. This re-export keeps the
 * e2e specs' own import path unchanged.
 */

export { startLoopbackOpenAiProvider, type LoopbackOpenAiProvider } from '../../scripts/loopbackOpenAiProvider.ts';
