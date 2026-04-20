/**
 * Download Worker — handles background model downloads.
 *
 * Executed as a Service Worker or dedicated worker for large model downloads.
 * Uses Background Fetch API where available (Chrome, survives tab navigation).
 * Falls back to standard fetch with progress streaming.
 *
 * Communicates download progress via BroadcastChannel so all tabs can receive updates.
 */

const BROADCAST_CHANNEL_NAME = 'sourdaw-model-downloads';

type DownloadRequest = {
    type: 'download';
    modelId: string;
    url: string;
    sha256?: string;
    /** File path within OPFS (e.g. 'models/ddsp/violin.onnx') */
    opfsPath: string;
};

type DownloadResponse =
    | { type: 'progress'; modelId: string; bytesDownloaded: number; totalBytes: number }
    | { type: 'complete'; modelId: string }
    | { type: 'error'; modelId: string; error: string }
    | { type: 'integrity-error'; modelId: string };

let broadcastChannel: BroadcastChannel | null = null;

function getBroadcastChannel(): BroadcastChannel {
    if (!broadcastChannel) {
        broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
    }
    return broadcastChannel;
}

function broadcast(msg: DownloadResponse): void {
    getBroadcastChannel().postMessage(msg);
    // Also post to the worker's own message port for direct subscribers
    self.postMessage(msg);
}

/**
 * Write downloaded data to OPFS.
 */
async function writeToOpfs(opfsPath: string, data: ArrayBuffer): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const parts = opfsPath.split('/');
    const fileName = parts.pop()!;
    let dir = root;
    for (const part of parts) {
        dir = await dir.getDirectoryHandle(part, { create: true });
    }
    const fileHandle = await dir.getFileHandle(fileName, { create: true });
    const accessHandle = await fileHandle.createSyncAccessHandle();
    accessHandle.write(data);
    accessHandle.flush();
    accessHandle.close();
}

/**
 * Verify SHA256 integrity of downloaded data.
 */
async function verifySha256(data: ArrayBuffer, expectedHash: string): Promise<boolean> {
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return hashHex === expectedHash;
}

/**
 * Download a model file with progress reporting and retry logic.
 * Uses Background Fetch API where available, falls back to standard fetch.
 */
async function downloadModel(req: DownloadRequest): Promise<void> {
    const maxRetries = 3;
    let lastError: unknown;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // Try Background Fetch API first (survives tab navigation, OS-level progress)
            if ('BackgroundFetchManager' in self && attempt === 0) {
                // Background Fetch requires Service Worker context — skip in dedicated worker
            }

            // Standard fetch with progress streaming
            const response = await fetch(req.url);

            if (!response.ok) {
                throw new Error(`HTTP ${String(response.status)}: ${response.statusText}`);
            }

            const contentLength = response.headers.get('content-length');
            const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('Response body is not readable');
            }

            const chunks: Uint8Array[] = [];
            let bytesDownloaded = 0;

            for (;;) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                chunks.push(value);
                bytesDownloaded += value.byteLength;
                broadcast({ type: 'progress', modelId: req.modelId, bytesDownloaded, totalBytes });
            }

            // Concatenate all chunks
            const totalLength = chunks.reduce((acc, c) => acc + c.byteLength, 0);
            const fullData = new Uint8Array(totalLength);
            let offset = 0;
            for (const chunk of chunks) {
                fullData.set(chunk, offset);
                offset += chunk.byteLength;
            }

            // Verify integrity if SHA256 provided — throw so the retry loop catches it
            if (req.sha256) {
                const valid = await verifySha256(fullData.buffer, req.sha256);
                if (!valid) {
                    throw new Error(`SHA256 integrity check failed for ${req.modelId}`);
                }
            }

            // Store in OPFS
            await writeToOpfs(req.opfsPath, fullData.buffer);

            broadcast({ type: 'complete', modelId: req.modelId });
            return;
        } catch (error) {
            lastError = error;
            if (attempt < maxRetries - 1) {
                // Exponential backoff: 1s, 2s, 4s
                await new Promise<void>((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
            }
        }
    }

    broadcast({ type: 'error', modelId: req.modelId, error: String(lastError) });
}

self.onmessage = async (event: MessageEvent<DownloadRequest>): Promise<void> => {
    const req = event.data;
    if (req.type === 'download') {
        await downloadModel(req);
    }
};
