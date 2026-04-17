/**
 * CapabilityBanner — shows a dismissible warning strip at the top of the app
 * when the browser environment is missing a capability that silently disables
 * core features.
 *
 * When `crossOriginIsolated` or `SharedArrayBuffer` is unavailable, every
 * SAB-backed plugin (Grand Boule, Gluten, Proof, Grinder, Bacteria, Scoring)
 * fails to initialise and `buildDeviceChain` skips the node. A per-insert
 * toast already fires, but five plugins in a session means five toasts; this
 * banner is a single session-level advisory that stays up until acknowledged.
 *
 * The banner does not block interaction; the app is still usable for every
 * feature that does not need SAB.
 */

import { type ReactElement, useState } from 'react';
import { X } from 'lucide-react';
import { getRuntimeCapabilities } from '#/utils/capabilities';

const DISMISS_KEY = 'sourdaw-capability-banner-dismissed';

function readDismissedAt(): string | null {
    try {
        return sessionStorage.getItem(DISMISS_KEY);
    } catch {
        // Private browsing / quota errors — treat as "not dismissed".
        return null;
    }
}

function writeDismissedAt(value: string): void {
    try {
        sessionStorage.setItem(DISMISS_KEY, value);
    } catch {
        // Ignore storage failures — banner will reappear next render.
    }
}

export const CapabilityBanner = (): ReactElement | null => {
    const capabilities = getRuntimeCapabilities();
    const needsBanner = !capabilities.hasSharedArrayBuffer || !capabilities.isCrossOriginIsolated;

    const [dismissed, setDismissed] = useState<boolean>(() => readDismissedAt() !== null);

    if (!needsBanner) {
        return null;
    }
    if (dismissed) {
        return null;
    }

    const reasons: string[] = [];
    if (!capabilities.isCrossOriginIsolated) {
        reasons.push('cross-origin isolation');
    }
    if (!capabilities.hasSharedArrayBuffer) {
        reasons.push('SharedArrayBuffer');
    }

    return (
        <div
            role="alert"
            className="flex items-center gap-3 px-3 py-1.5 text-xs border-b border-amber-500/30 bg-amber-950/40 text-amber-200"
        >
            <span className="font-semibold uppercase tracking-wide text-[10px] text-amber-300">Degraded</span>
            <span className="flex-1 leading-tight">
                Some plugins (Grand Boule, Gluten, Proof, Grinder, Bacteria, Scoring) are disabled because this browser
                session is missing {reasons.join(' and ')}. Check that the server sends{' '}
                <code className="font-mono text-[11px]">Cross-Origin-Opener-Policy: same-origin</code> and{' '}
                <code className="font-mono text-[11px]">Cross-Origin-Embedder-Policy: require-corp</code>.
            </span>
            <button
                type="button"
                aria-label="Dismiss capability warning"
                onClick={() => {
                    writeDismissedAt(new Date().toISOString());
                    setDismissed(true);
                }}
                className="shrink-0 p-1 rounded hover:bg-amber-500/20 transition-colors cursor-pointer"
            >
                <X className="size-3.5" />
            </button>
        </div>
    );
};
