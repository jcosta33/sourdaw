"""Qualify genuine producer routes, source maps and unchanged public/schema bytes."""
import base64
import hashlib
import json
import re
import sys
from pathlib import Path

BASE = Path(__file__).resolve().parent
if len(sys.argv) != 2:
    raise SystemExit('Usage: qualify-output.py <private-capsule>')
CAPSULE = Path(sys.argv[1]).resolve()
WEB = CAPSULE / 'js/web'
records = json.loads((BASE / 'bundles.json').read_text())
pins = json.loads((BASE / 'protobuf-port-inputs.json').read_text())
receipt = json.loads((WEB / 'dist/protobuf-port-receipt.json').read_text())
sha = lambda data: hashlib.sha256(data).hexdigest()
assert receipt['version'] == 1
assert receipt['esbuild'] == '0.28.2'
assert receipt['useWebgpuEp'] is False and receipt['useJspi'] is False
assert receipt['argv'] == ['--bundle-mode=prod', '--bundle-scope=protobuf-port', '--no-webgpu-ep', '--no-jspi']
assert receipt['upstreamTagCommit'] == '6af1a932e2286d5c58166085d24c68783033edee'
assert receipt['producerSha256'] == sha((WEB / 'script/build.js').read_bytes())
expected_inputs = {f'{name}/{item["path"]}': item['sha256'] for name in ['protobufjs', 'long'] for item in pins[name]['files']}
assert receipt['runtimeInputs'] == expected_inputs
expected_outputs = {Path(record['path']).name for record in records}
expected_outputs |= {name + '.map' for name in list(expected_outputs) if '.min.' in name}
assert set(receipt['outputs']) == expected_outputs
for name, digest in receipt['outputs'].items():
    assert sha((WEB / 'dist' / name).read_bytes()) == digest, f'Changed actual output: {name}'
for record in records:
    output = WEB / record['path']
    data = output.read_bytes()
    if record['sourceMap'] == 'inline':
        marker = b'sourceMappingURL=data:application/json;base64,'
        mapping = json.loads(base64.b64decode(data.rsplit(marker, 1)[1].strip()))
    else:
        mapping = json.loads((output.parent / record['mapPath']).read_text())
    seen = set()
    for name, source in zip(mapping['sources'], mapping['sourcesContent'], strict=True):
        normalized = name.replace('\\', '/')
        assert '/@protobufjs/' not in normalized, f'Old protobuf leaf input: {name}'
        match = re.search(r'/(protobufjs(?:@[^/]+)?)/(.*)$', normalized)
        if match:
            key = 'protobufjs/' + match.group(2)
            assert key in expected_inputs and sha(source.encode()) == expected_inputs[key], f'Wrong actual protobuf input: {name}'
            seen.add(key)
        if normalized.endswith('/ort-schema/protobuf/onnx.js'):
            assert sha(source.encode()) == 'b6cb83ec708b51f5bcce8295a2dc1452e430d6c8696db2da68c5233d9359cb3f'
            seen.add('schema')
    assert {'protobufjs/src/reader.js', 'protobufjs/src/writer.js', 'protobufjs/src/index-minimal.js', 'schema'} <= seen
    metadata = json.loads(Path(str(output) + '.esbuild.metafile.json').read_text())
    assert metadata['inputs'] and metadata['outputs']
    for name in metadata['inputs']:
        file = (CAPSULE / 'js' / name).resolve()
        if file.is_file() and '/protobufjs@8.8.1/' in file.as_posix():
            relative = file.as_posix().split('/protobufjs@8.8.1/', 1)[1]
            assert sha(file.read_bytes()) == expected_inputs['protobufjs/' + relative]
assert sha((WEB / 'lib/onnxjs/ort-schema/protobuf/onnx.d.ts').read_bytes()) == 'd479078157836d35ddd280399fe9e29aab59f5b943436a28f6546b0ccea881d7'
provenance = json.loads((BASE.parent / 'provenance.json').read_text())
record = next(item for item in provenance['packages'] if item['name'] == 'onnxruntime-web')
for file in ['types.d.ts', 'lib/onnxjs/ort-schema/protobuf/onnx.js']:
    assert sha((WEB / file).read_bytes()) == record['files'][file]
metadata = json.loads((WEB / 'package.json').read_text())
assert metadata['dependencies']['protobufjs'] == '8.8.1'
assert sha((WEB / 'package.json').read_bytes()) == record['files']['package.json']
for name, digest in receipt['outputs'].items():
    assert digest == record['files']['dist/' + name], f'Output differs from qualified checkpoint: {name}'
print('Qualified nine outputs, linked and inline maps, genuine8 inputs and unchanged schema/public types.')
