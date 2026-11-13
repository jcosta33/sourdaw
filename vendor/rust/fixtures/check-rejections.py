"""Compile the actual consumer examples and require their specific rejection."""
from pathlib import Path
import subprocess

MANIFEST = Path(__file__).with_name('Cargo.toml')
CASES = {
    'num_enum_duplicate_alternatives': ('9', 'already'),
    'num_enum_invalid_repr': ("repr(C) doesn't have a well defined size",),
    'tracing_unknown_skip': ('missing', 'parameter'),
    'tracing_unsafe_to_safe': ('unsafe', 'safe'),
    'visibility_unsafe_to_safe': ('unsafe', 'safe'),
    'visibility_unsupported_impl': ('visibility', 'impl'),
}
for name, required in CASES.items():
    result = subprocess.run(
        ['cargo', 'check', '--manifest-path', str(MANIFEST), '--example', f'reject_{name}'],
        text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False,
    )
    print(result.stdout, end='')
    if result.returncode == 0 or not all(word in result.stdout for word in required):
        raise SystemExit(f'{name}: expected the consumer-specific rejection containing {required!r}')
    print(f'expected-rejection: {name}')
print(f'expected-rejections: {len(CASES)} of {len(CASES)}')
