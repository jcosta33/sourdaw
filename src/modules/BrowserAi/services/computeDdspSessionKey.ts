import { type DdspArtifact } from '../models/DdspArtifactManifest';

export const DDSP_TFJS_RUNTIME_REVISION = 'tfjs-4.22.0-webgpu-raw-v1';

type DdspManifestIdentity = {
    artifactVersion: string;
    artifacts: readonly DdspArtifact[];
};

type DdspSessionIdentity = DdspManifestIdentity & { instrumentId: string };

/** Hash every ordered manifest field that can select different runtime bytes. */
export async function computeDdspManifestFingerprint(
    manifest: DdspManifestIdentity,
    runtimeRevision: string
): Promise<string> {
    const canonical = JSON.stringify([
        runtimeRevision,
        manifest.artifactVersion,
        manifest.artifacts.map(({ path, url, sizeBytes, sha256 }) => [path, url, sizeBytes, sha256]),
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Identify one instrument session by its complete pinned manifest and runtime algorithm. */
export async function computeDdspSessionKey(manifest: DdspSessionIdentity): Promise<string> {
    const fingerprint = await computeDdspManifestFingerprint(manifest, DDSP_TFJS_RUNTIME_REVISION);
    return `${manifest.instrumentId}:${manifest.artifactVersion}:${fingerprint}`;
}
