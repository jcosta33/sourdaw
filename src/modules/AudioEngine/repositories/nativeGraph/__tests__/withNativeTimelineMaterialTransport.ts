import { type NativeGraphTransport, type NativeTimelineMaterialDescriptor } from '../nativeGraphTransport';

type Material = {
    owner: string;
    descriptor: NativeTimelineMaterialDescriptor;
    pcm?: Uint8Array;
    pins: number;
    readers: number;
    retired: boolean;
};
type Lease = { owner: string; keys: string[] };
const owners = new Set<string>();
const materials = new Map<string, Material>();
const leases = new Map<string, Lease>();
let sequence = 0;
const MAX_BYTES = 512 * 1024 * 1024;

function key(owner: string, sourceId: string, version: string): string {
    return JSON.stringify([owner, sourceId, version]);
}

function requireLease(token: string): Lease {
    const lease = leases.get(token);
    if (!lease || !owners.has(lease.owner)) {
        throw new Error('Timeline material lease is closed');
    }
    return lease;
}

function release(token: string): void {
    const lease = leases.get(token);
    if (!lease) {
        return;
    }
    leases.delete(token);
    for (const id of lease.keys) {
        const row = materials.get(id);
        if (row) {
            row.pins -= 1;
            if (!row.pcm && row.pins === 0) {
                materials.delete(id);
            }
        }
    }
}

function bytes(row: Material): number {
    return row.descriptor.frames * row.descriptor.channels * 4;
}

function validateBatch(batch: Parameters<NativeGraphTransport['renderGraphOffline']>[0]['batch']): string[] {
    if (!batch.timelineLease) {
        throw new Error('Graph batch requires a timeline material lease');
    }
    const lease = requireLease(batch.timelineLease);
    for (const id of lease.keys) {
        if (!materials.get(id)?.pcm) {
            throw new Error('Timeline material lease has pending uploads');
        }
    }
    for (const command of batch.commands) {
        if (command.kind !== 'schedule-clip') {
            continue;
        }
        const source = command.playback.source;
        const version: unknown = Reflect.get(source, 'materialVersion');
        if (typeof version !== 'string' || !lease.keys.includes(key(lease.owner, source.sourceId, version))) {
            throw new Error('schedule-clip material is outside its lease');
        }
    }
    return lease.keys;
}

/** Native protocol model around existing scripted callbacks. This supplies no audio proof. */
export function withNativeTimelineMaterialTransport(transport: NativeGraphTransport): NativeGraphTransport {
    return {
        ...transport,
        async timelineSampleLifecycle(request) {
            if (request.action === 'open') {
                const owner = `test-owner-${++sequence}`;
                owners.add(owner);
                return { owner };
            }
            if (request.action === 'release') {
                release(request.lease);
                return { released: true };
            }
            if (request.action === 'retire') {
                owners.delete(request.owner);
                for (const [token, lease] of leases) {
                    if (lease.owner === request.owner) {
                        release(token);
                    }
                }
                let remainingReaders = 0;
                for (const [id, row] of materials) {
                    if (row.owner !== request.owner) {
                        continue;
                    }
                    row.retired = true;
                    if (row.readers) {
                        remainingReaders += 1;
                    } else {
                        materials.delete(id);
                    }
                }
                return { complete: remainingReaders === 0, remainingReaders, pendingFence: false };
            }
            if (!owners.has(request.owner)) {
                throw new Error('Timeline material owner is closed');
            }
            if (leases.size >= 256 || request.materials.length > 8192) {
                throw new Error('Timeline material capacity exceeded');
            }
            const keys = request.materials.map((row) => key(request.owner, row.sourceId, row.version));
            if (new Set(keys).size !== keys.length) {
                throw new Error('Duplicate material descriptor');
            }
            let total = [...materials.values()].reduce((sum, row) => sum + bytes(row), 0);
            for (const descriptor of request.materials) {
                if (
                    !descriptor.sourceId ||
                    !descriptor.version ||
                    descriptor.frames <= 0 ||
                    !Number.isSafeInteger(descriptor.frames) ||
                    ![1, 2].includes(descriptor.channels) ||
                    !Number.isFinite(descriptor.sampleRate) ||
                    descriptor.sampleRate <= 0
                ) {
                    throw new Error('Invalid material descriptor');
                }
                const existing = materials.get(key(request.owner, descriptor.sourceId, descriptor.version));
                if (existing && JSON.stringify(existing.descriptor) !== JSON.stringify(descriptor)) {
                    throw new Error('Material version changed shape');
                }
                if (!existing) {
                    total += descriptor.frames * descriptor.channels * 4;
                }
            }
            const eviction: string[] = [];
            for (const [id, row] of materials) {
                if (total <= MAX_BYTES) {
                    break;
                }
                if (!keys.includes(id) && row.pins === 0 && row.readers === 0) {
                    eviction.push(id);
                    total -= bytes(row);
                }
            }
            if (total > MAX_BYTES) {
                throw new Error('Timeline material working set exceeds native pool budget');
            }
            for (const id of eviction) {
                materials.delete(id);
            }
            const missing: NativeTimelineMaterialDescriptor[] = [];
            for (const [index, descriptor] of request.materials.entries()) {
                const id = keys[index]!;
                let row = materials.get(id);
                if (!row) {
                    row = { owner: request.owner, descriptor, pins: 0, readers: 0, retired: false };
                    materials.set(id, row);
                }
                row.pins += 1;
                if (!row.pcm) {
                    missing.push(descriptor);
                }
            }
            const lease = `test-lease-${++sequence}`;
            leases.set(lease, { owner: request.owner, keys });
            return { lease, missing };
        },
        async registerTimelineMaterial(input) {
            const lease = requireLease(input.lease);
            const id = key(lease.owner, input.sampleId, input.version);
            const row = materials.get(id);
            if (
                !lease.keys.includes(id) ||
                !row ||
                bytes(row) !== input.pcm.byteLength ||
                row.descriptor.sampleRate !== input.sampleRate ||
                row.descriptor.channels !== input.channels
            ) {
                throw new Error('Upload does not match timeline reservation');
            }
            if (row.pcm) {
                if (row.pcm.some((value, index) => value !== input.pcm[index])) {
                    throw new Error('Timeline material version is immutable');
                }
                return { frames: row.descriptor.frames };
            }
            const result = await transport.registerTimelineSample({
                sampleId: input.sampleId,
                sampleRate: input.sampleRate,
                channels: input.channels,
                pcm: input.pcm,
            });
            requireLease(input.lease);
            row.pcm = new Uint8Array(input.pcm);
            return result;
        },
        async applyGraphCommands(input) {
            validateBatch(input.batch);
            return transport.applyGraphCommands(input);
        },
        async mapGraphBatch(input) {
            validateBatch(input.batch);
            return transport.mapGraphBatch(input);
        },
        async renderGraphOffline(input) {
            const held = validateBatch(input.batch).map((id) => ({ id, row: materials.get(id)! }));
            for (const { row } of held) {
                row.readers += 1;
            }
            try {
                return await transport.renderGraphOffline(input);
            } finally {
                for (const { id, row } of held) {
                    row.readers -= 1;
                    if (row.retired && row.readers === 0) {
                        materials.delete(id);
                    }
                }
            }
        },
    };
}
