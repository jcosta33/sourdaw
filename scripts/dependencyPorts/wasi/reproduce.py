"""Reproduce the bounded scheduler port from authenticated public inputs.

Usage: python3 reproduce.py <official-source.tgz> <runtime-1.11.3.tgz> <absent-output>
The source capsule is https://codeload.github.com/toyobayashi/emnapi/tar.gz/
b2011ea96d28fe60a6b8eabb82c2d6264daf7460.
"""
from pathlib import Path
import base64
import difflib
import hashlib
import json
import re
import sys
import tarfile

source_archive, runtime_archive, output = map(Path, sys.argv[1:])
assert not output.exists(), "Reproduction output must be absent"
assert hashlib.sha256(source_archive.read_bytes()).hexdigest() == "83e8952bab1f13b8196701d50d93a6edbfc327376751f7224dbc8bc089c3512d"
manifest = json.loads((Path(__file__).resolve().parents[1] / "jsToolingProvenance.json").read_text())
record = next(row for row in manifest["packages"] if row["name"] == "@emnapi/runtime")
assert "sha512-" + base64.b64encode(hashlib.sha512(runtime_archive.read_bytes()).digest()).decode() == record["integrity"]
with tarfile.open(source_archive) as tar:
    source = tar.extractfile("emnapi-b2011ea96d28fe60a6b8eabb82c2d6264daf7460/packages/runtime/src/env.ts").read().decode()
assert hashlib.sha256(source.encode()).hexdigest() == "0ce5c9619ffb27c918a7433f2dff10f987b4be9e7e8b11d50548a4590722d41d"
assert source.count("_setImmediate(() => {") == 1
canonical = source.replace("  _setImmediate,\n", "").replace("_setImmediate(() => {", "this.ctx.feature.setImmediate(() => {")
assert hashlib.sha256(canonical.encode()).hexdigest() == "2476f39ec8cb07635eb5fa5660b1e82e8d1adb5e2a3e12a9c406a15aa6e642d7"
source_file = output / "modified-source/packages/runtime/src/env.ts"
source_file.parent.mkdir(parents=True)
source_file.write_bytes(canonical.encode())

def diff(before, after, name):
    return "diff --git a/" + name + " b/" + name + "\n" + "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True), fromfile="a/" + name, tofile="b/" + name))

changed = {}
with tarfile.open(runtime_archive) as tar:
    for item in tar.getmembers():
        if not item.isfile():
            continue
        name = item.name.removeprefix("package/")
        data = tar.extractfile(item).read()
        if name.startswith("dist/") and name.endswith((".js", ".mjs")):
            before = data.decode()
            if ".min." in name:
                marker = "this.finalizationScheduled||this.destructing||"
                assert before.count(marker) == 1
                start = before.index(marker)
                end = before.index("drainFinalizerQueue()", start) + len("drainFinalizerQueue()")
                area = before[start:end]
                pattern = r"(this\.ref\(\),)([A-Za-z_$][\w$]*)(\((?:\(\)=>|function\(\)))"
                assert len(list(re.finditer(pattern, area))) == 1
                after = before[:start] + re.sub(pattern, r"\1this.ctx.feature.setImmediate\3", area) + before[end:]
            else:
                prototype = "NodeEnv.prototype.enqueueFinalizer = function"
                needle = prototype if prototype in before else "    enqueueFinalizer(finalizer) {"
                start = before.index(needle)
                end = before.index("NodeEnv.prototype.drainFinalizerQueue" if needle == prototype else "    drainFinalizerQueue()", start)
                area = before[start:end]
                assert area.count("_setImmediate(") == 1
                after = before[:start] + area.replace("_setImmediate(", "this.ctx.feature.setImmediate(") + before[end:]
            data = after.encode()
            changed[name] = diff(before, after, name)
        assert hashlib.sha256(data).hexdigest() == record["files"][name], name
        target = output / "package" / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
patch = "".join(changed[name] for name in sorted(changed))
assert hashlib.sha256(patch.encode()).hexdigest() == record["patchSha256"]
(output / "emnapi-runtime-1.11.3.patch").write_bytes(patch.encode())
canonical_patch = diff(source, canonical, "packages/runtime/src/env.ts")
assert canonical_patch == (Path(__file__).resolve().parent / "canonical-source.patch").read_text()
(output / "canonical-source.patch").write_text(canonical_patch)
print("Reproduced canonical source and all eight exact published scheduler routes")
