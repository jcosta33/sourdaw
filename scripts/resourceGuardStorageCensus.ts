function parseLsofFile(
    fields: string[],
    knownTypes: Set<string>,
    report: (reason: string) => void
): { path?: string; missingType: boolean } | undefined {
    const unavailable = (reason: string) => {
        report(reason);
        return undefined;
    };
    if (!/^f(?:\d+|cwd|twd|txt|mem|rtd|pd|fp\.)$/.test(fields[0] ?? '')) {
        return unavailable('invalid-descriptor');
    }
    const type = fields.find((field) => field.startsWith('t'))?.slice(1);
    const name = fields.find((field) => field.startsWith('n'))?.slice(1);
    if (type !== undefined && !knownTypes.has(type)) {
        return unavailable('unknown-file-type');
    }
    if (
        fields.some((field) => !/^[ftn]/.test(field)) ||
        new Set(fields.map((field) => field[0])).size !== fields.length
    ) {
        return unavailable('invalid-file-fields');
    }
    if (name !== undefined && /Permission denied|Operation not permitted|no info|\((?:stat|readlink):/i.test(name)) {
        return unavailable('file-inspection-diagnostic');
    }
    if (type === undefined && (fields.length !== 2 || name === undefined || name === '')) {
        return unavailable('invalid-file-fields');
    }
    if (type === 'REG' || type === 'DIR') {
        if (name === undefined || !name.startsWith('/')) {
            return unavailable('missing-file-path');
        }
        return { path: name, missingType: false };
    }
    return { missingType: type === undefined };
}

export function parseLsofCensus(
    output: string,
    report: (reason: string) => void = () => {}
): { pids: Set<number>; paths: string[] } | undefined {
    const unavailable = (reason: string) => {
        report(reason);
        return undefined;
    };
    if (!output.endsWith('\0\n')) {
        return unavailable('truncated-record');
    }
    const pids = new Set<number>();
    const paths: string[] = [];
    let fileCount = 0;
    let missingType = false;
    const knownTypes = new Set([
        'REG',
        'DIR',
        'CHR',
        'BLK',
        'FIFO',
        'IPv4',
        'IPv6',
        'unix',
        'PIPE',
        'KQUEUE',
        'NPOLICY',
        'systm',
        'NEXUS',
        'CHAN',
        'PSXSEM',
        'PSXSHM',
    ]);
    for (const set of output.slice(0, -2).split('\0\n')) {
        const fields = set.split('\0');
        const first = fields[0] ?? '';
        if (first.startsWith('p')) {
            if (pids.size > 0 && fileCount === 0) {
                return unavailable('process-without-files');
            }
            const pid = Number(first.slice(1));
            if (!/^p[1-9]\d*$/.test(first) || !Number.isSafeInteger(pid) || fields.length !== 1 || pids.has(pid)) {
                return unavailable('invalid-process-record');
            }
            pids.add(pid);
            fileCount = 0;
            continue;
        }
        if (pids.size === 0) {
            return unavailable('invalid-descriptor');
        }
        const file = parseLsofFile(fields, knownTypes, report);
        if (file === undefined) {
            return undefined;
        }
        missingType ||= file.missingType;
        if (file.path !== undefined) {
            paths.push(file.path);
        }
        fileCount += 1;
    }
    if (fileCount === 0) {
        return unavailable('process-without-files');
    }
    return missingType ? unavailable('descriptor-type-missing') : { pids, paths };
}
