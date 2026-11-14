$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$request = [Console]::In.ReadToEnd() | ConvertFrom-Json
if ($request.schemaVersion -ne 1) { throw 'Unsupported private-cache request' }
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User
if ($null -eq $userSid) { throw 'Current token has no user SID' }
$trusted = @($userSid.Value, 'S-1-5-18', 'S-1-5-32-544')

function Assert-NoReparse([string] $path) {
    $volume = [System.IO.Path]::GetPathRoot($path)
    if ($volume.StartsWith('\\')) { throw 'Private compiler cache requires a local drive' }
    $walk = $volume
    foreach ($part in $path.Substring($volume.Length).Split([char]'\', [StringSplitOptions]::RemoveEmptyEntries)) {
        $walk = [System.IO.Path]::Combine($walk, $part)
        if (([System.IO.File]::GetAttributes($walk) -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Reparse point in private compiler cache path' }
    }
}

function Assert-Descriptor([string] $path, [bool] $parent) {
    Assert-NoReparse $path
    $acl = Get-Acl -LiteralPath $path
    $raw = [System.Security.AccessControl.RawSecurityDescriptor]::new($acl.GetSecurityDescriptorBinaryForm(), 0)
    if (-not ($raw.ControlFlags -band [System.Security.AccessControl.ControlFlags]::DiscretionaryAclPresent) -or $null -eq $raw.DiscretionaryAcl) { throw 'Missing or null private-cache DACL' }
    if ($parent) {
        if ($raw.Owner.Value -notin $trusted) { throw 'Untrusted immediate cache parent owner' }
    } elseif ($raw.Owner.Value -ne $userSid.Value) { throw 'Private-cache entry owner differs from current token' }
    # Parent replacement rights differ from content mutation within the fence.
    $dangerous = if ($parent) { [uint32]0x500C0040 } else { [uint32]0x500D0156 }
    foreach ($ace in $raw.DiscretionaryAcl) {
        if ($ace -isnot [System.Security.AccessControl.CommonAce] -or $ace.IsCallback) { throw 'Unsupported private-cache ACE' }
        $mask = [uint32]([int64]$ace.AccessMask -band 0xffffffffL)
        if ($ace.AceQualifier -eq [System.Security.AccessControl.AceQualifier]::AccessAllowed) {
            if ($ace.SecurityIdentifier.Value -notin $trusted -and ($mask -band $dangerous) -ne 0) { throw 'Foreign SID has private-cache mutation rights' }
        } elseif ($ace.AceQualifier -ne [System.Security.AccessControl.AceQualifier]::AccessDenied) { throw 'Unsupported private-cache ACE qualifier' }
    }
}

if ($request.operation -eq 'default-root') {
    $local = [Environment]::GetFolderPath([Environment+SpecialFolder]::LocalApplicationData)
    if ([string]::IsNullOrWhiteSpace($local) -or -not [System.IO.Path]::IsPathRooted($local)) { throw 'Native LocalApplicationData is unavailable' }
    $result = [System.IO.Path]::Combine($local, 'SourdawNativeTypeScript')
} else {
    if (-not [System.IO.Path]::IsPathRooted([string]$request.root)) { throw 'Expected absolute private-cache root' }
    $root = [System.IO.Path]::GetFullPath([string]$request.root)
    $parent = [System.IO.Directory]::GetParent($root)
    if ($null -eq $parent) { throw 'Private-cache root cannot be a volume root' }
    Assert-Descriptor $parent.FullName $true
    if ($request.operation -eq 'create') {
        $target = [System.IO.Path]::GetFullPath([string]$request.path)
        if (-not [string]::Equals($target, $root, [StringComparison]::OrdinalIgnoreCase) -and -not $target.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Creation outside private-cache root' }
        $security = [System.Security.AccessControl.DirectorySecurity]::new()
        $security.SetOwner($userSid)
        $security.SetAccessRuleProtection($true, $false)
        $rule = [System.Security.AccessControl.FileSystemAccessRule]::new($userSid, [System.Security.AccessControl.FileSystemRights]::FullControl, [System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit', [System.Security.AccessControl.PropagationFlags]::None, [System.Security.AccessControl.AccessControlType]::Allow)
        $security.AddAccessRule($rule)
        $paths = [System.Collections.Generic.List[string]]::new()
        $walk = $target
        while (-not [System.IO.Directory]::Exists($walk)) {
            $paths.Insert(0, $walk)
            if ([string]::Equals($walk, $root, [StringComparison]::OrdinalIgnoreCase)) { break }
            $walk = [System.IO.Directory]::GetParent($walk).FullName
        }
        if ([System.IO.Directory]::Exists($root)) { Assert-Descriptor $root $false }
        $existing = $target
        while ($existing.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) {
            if ([System.IO.Directory]::Exists($existing)) { Assert-Descriptor $existing $false }
            $existing = [System.IO.Directory]::GetParent($existing).FullName
        }
        foreach ($path in $paths) {
            # Windows PowerShell 5/.NET Framework applies the DACL at creation.
            [void][System.IO.Directory]::CreateDirectory($path, $security)
            Assert-Descriptor $path $false
        }
        Assert-Descriptor $target $false
        $result = $target
    } elseif ($request.operation -eq 'verify') {
        Assert-Descriptor $root $false
        foreach ($entry in $request.entries) {
            $path = [System.IO.Path]::GetFullPath([string]$entry.path)
            if (-not $path.StartsWith($root.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Verification outside private-cache root' }
            Assert-Descriptor $path $false
            $isDirectory = ([System.IO.File]::GetAttributes($path) -band [System.IO.FileAttributes]::Directory) -ne 0
            if (($entry.kind -eq 'directory') -ne $isDirectory) { throw 'Private-cache entry has wrong kind' }
        }
        $result = $root
    } else { throw 'Unsupported private-cache operation' }
}
[ordered]@{ schemaVersion = 1; status = 'verified'; result = $result } | ConvertTo-Json -Compress
