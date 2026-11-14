// @vitest-environment node

import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, win32 } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
    ensurePrivateNativeTypeScriptDirectory,
    getPreparedNativeTypeScriptPath,
    nativeTypeScriptCacheDirectory,
} from '../nativeTypeScript/compiler.mjs';
import { windowsPrivateCache } from '../nativeTypeScript/windowsCache.mjs';

let root: string;
let directory: string;
let binary: string;
let originalBinary: string;
let previous: string | undefined;

// Every mutation is an actual Windows ACL operation. Fixture privilege or
// platform-policy failures fail the case; they are never converted to a pass.
function changeAcl(action: string, path: string) {
    const command = `
$ErrorActionPreference = 'Stop'
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
$acl = Get-Acl -LiteralPath $request.path
$sid = [System.Security.Principal.SecurityIdentifier]::new('S-1-1-0')
switch ($request.action) {
    'write' { $rights = [System.Security.AccessControl.FileSystemRights]::WriteData }
    'delete-child' { $rights = [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles }
    'write-dac' { $rights = [System.Security.AccessControl.FileSystemRights]::ChangePermissions }
    'inherited' { $rights = [System.Security.AccessControl.FileSystemRights]::WriteData }
    'owner' { $acl.SetOwner([System.Security.Principal.SecurityIdentifier]::new('S-1-5-32-544')) }
    'null-dacl' {
        $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
        $raw.DiscretionaryAcl = $null
        $bytes = [byte[]]::new($raw.BinaryLength)
        $raw.GetBinaryForm($bytes, 0)
        $acl.SetSecurityDescriptorBinaryForm($bytes)
    }
    default { throw 'Unknown ACL fixture action' }
}
if ($null -ne $rights) {
    if ($request.action -eq 'inherited') {
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
    } else { $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($sid, $rights, [System.Security.AccessControl.AccessControlType]::Allow) }
    $acl.AddAccessRule($rule)
}
Set-Acl -LiteralPath $request.path -AclObject $acl
`;
    if (!process.env.SystemRoot) throw new Error('Missing Windows SystemRoot in real ACL fixture');
    execFileSync(
        win32.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),
        ['-NoProfile', '-NonInteractive', '-Command', command],
        { shell: false, input: JSON.stringify({ action, path }), timeout: 30_000, maxBuffer: 64 * 1024 }
    );
}

describe.runIf(process.platform === 'win32')('native compiler private cache on actual Windows', () => {
    beforeEach(() => {
        originalBinary = getPreparedNativeTypeScriptPath();
        previous = process.env.SOURDAW_NATIVE_TS_CACHE;
        root = join(tmpdir(), `sourdaw-cache ' ; $() ${randomUUID()}`);
        process.env.SOURDAW_NATIVE_TS_CACHE = root;
        ensurePrivateNativeTypeScriptDirectory(root);
        directory = nativeTypeScriptCacheDirectory();
        ensurePrivateNativeTypeScriptDirectory(directory);
        binary = join(directory, 'tsgo.exe');
        copyFileSync(originalBinary, binary);
        writeFileSync(join(directory, 'receipt.json'), readFileSync(join(dirname(originalBinary), 'receipt.json')));
        expect(getPreparedNativeTypeScriptPath()).toBe(binary);
    });

    afterEach(() => {
        if (previous === undefined) delete process.env.SOURDAW_NATIVE_TS_CACHE;
        else process.env.SOURDAW_NATIVE_TS_CACHE = previous;
        rmSync(root, { recursive: true, force: true });
    });

    it('accepts genuine prepared bytes under a native private DACL with literal shell characters', () => {
        expect(getPreparedNativeTypeScriptPath()).toBe(binary);
        expect(existsSync(join(root, 'injected-marker'))).toBe(false);
    });

    it.each(['write', 'write-dac', 'owner', 'null-dacl'])('refuses real executable %s ACL corruption', (action) => {
        changeAcl(action, binary);
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses an inherited foreign write grant', () => {
        changeAcl('inherited', root);
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses an unsafe immediate parent with foreign delete-child rights', () => {
        const unsafe = join(root, 'unsafe-parent');
        ensurePrivateNativeTypeScriptDirectory(unsafe);
        changeAcl('delete-child', unsafe);
        expect(() =>
            windowsPrivateCache({ operation: 'create', root: join(unsafe, 'child'), path: join(unsafe, 'child') })
        ).toThrow();
    });

    it('refuses an actual junction beneath its private root', () => {
        const junction = join(root, 'junction');
        symlinkSync(dirname(originalBinary), junction, 'junction');
        expect(() =>
            windowsPrivateCache({ operation: 'verify', root, entries: [{ path: junction, kind: 'directory' }] })
        ).toThrow();
    });

    it('refuses a receipt symlink to matching genuine bytes', () => {
        const receipt = join(directory, 'receipt.json');
        unlinkSync(receipt);
        symlinkSync(join(dirname(originalBinary), 'receipt.json'), receipt, 'file');
        expect(() => getPreparedNativeTypeScriptPath()).toThrow('Prepared locally patched');
    });

    it('refuses a missing entry and a path outside the private fence', () => {
        expect(() =>
            windowsPrivateCache({ operation: 'verify', root, entries: [{ path: join(root, 'absent'), kind: 'file' }] })
        ).toThrow();
        expect(() =>
            windowsPrivateCache({ operation: 'verify', root, entries: [{ path: originalBinary, kind: 'executable' }] })
        ).toThrow();
    });

    it('refuses an invalid trusted-system-directory selection', () => {
        const systemRoot = process.env.SystemRoot;
        process.env.SystemRoot = '.\\untrusted';
        try {
            expect(() => windowsPrivateCache({ operation: 'default-root' })).toThrow(
                'trusted absolute Windows SystemRoot'
            );
        } finally {
            process.env.SystemRoot = systemRoot;
        }
    });
});
