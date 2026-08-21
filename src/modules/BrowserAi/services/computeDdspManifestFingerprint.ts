import { type DdspArtifact } from '../models/DdspArtifactManifest';

type ComputeDdspManifestFingerprintInput = {
    artifactVersion: string;
    artifacts: readonly DdspArtifact[];
    renderAlgorithmRevision: string;
};

/** Fingerprints every ordered source field that can change a DDSP render. */
export async function computeDdspManifestFingerprint({
    artifactVersion,
    artifacts,
    renderAlgorithmRevision,
}: ComputeDdspManifestFingerprintInput): Promise<string> {
    const canonicalManifest = JSON.stringify([
        renderAlgorithmRevision,
        artifactVersion,
        artifacts.map(({ path, url, sizeBytes, sha256 }) => [path, url, sizeBytes, sha256]),
    ]);
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalManifest));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
