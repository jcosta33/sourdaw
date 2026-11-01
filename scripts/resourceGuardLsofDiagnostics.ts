export function lsofInspectionMatch(name: string, type: string | undefined): string | undefined {
    const operation = /\((stat|readlink):/i.exec(name)?.[1];
    if (operation !== undefined) {
        return operation.toLowerCase();
    }
    // Darwin libproc separates vnode paths from unrooted errno messages, so path words are not errors.
    if ((type === 'REG' || type === 'DIR' || type === 'LINK') && name.startsWith('/')) {
        return undefined;
    }
    return /Permission denied|Operation not permitted|no info/i.exec(name)?.[0].toLowerCase().replaceAll(' ', '-');
}

export function describeLsofInspection(
    pid: number,
    descriptorField: string | undefined,
    type: string | undefined,
    name: string | undefined,
    match: string
): string {
    // Keep only bounded field identities and the matched category, never names or catalog text.
    const descriptor = (descriptorField ?? '').slice(1);
    return `pid=${pid}:fd=${descriptor.length <= 20 ? descriptor : 'oversized'}:type=${type ?? 'missing'}:name=${name?.startsWith('/') ? 'absolute-path' : 'text'}:match=${match}`;
}
