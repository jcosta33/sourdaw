"""Observe installer output while the bound unit is still running, without a manager oracle."""

import importlib.util
import io
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch


spec = importlib.util.spec_from_file_location('hosted', 'scripts/hostedAptInstall.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class ProgressTest(unittest.TestCase):
    def test_output_is_visible_before_terminal_and_is_not_replayed(self):
        output = io.StringIO()
        shows = []
        clock = iter(range(1000))
        with tempfile.TemporaryDirectory() as directory:
            work = Path(directory)

            def command(*args, **_options):
                if args[0] == 'systemd-run':
                    (work / 'installer.log').write_text('acquisition started\n')
                if args[0] == 'apt-config':
                    self.assertEqual(args[1:], ('dump', 'Acquire::Retries', 'Acquire::http::Timeout', 'Acquire::https::Timeout'))
                    return subprocess.CompletedProcess(args, 0, 'Acquire::Retries "1";\n', '')
                return subprocess.CompletedProcess(args, 0, '', '')

            def manager(action, *args):
                if action != 'show':
                    return ''
                unit = args[0]
                if shows:
                    self.assertIn('acquisition started\n', output.getvalue())
                    (work / 'installer.log').write_text('acquisition started\nacquisition finished\n')
                fields = {
                    'Id': unit, 'Description': f'Sourdaw hosted apt {unit}',
                    'InvocationID': 'a' * 32, 'LoadState': 'loaded', 'Type': 'exec',
                    'ExitType': 'cgroup', 'RemainAfterExit': 'yes', 'CollectMode': 'inactive',
                    'KillMode': 'control-group', 'RuntimeMaxUSec': '1h',
                    'ActiveState': 'active', 'SubState': 'running' if not shows else 'exited',
                    'Result': 'success', 'ExecMainCode': '1', 'ExecMainStatus': '0',
                    'ControlGroup': '/system.slice/' + unit,
                }
                shows.append(fields)
                return '\n'.join(f'{key}={value}' for key, value in fields.items())

            with patch.object(module, 'manager', side_effect=manager), \
                    patch.object(module, 'command', side_effect=command), \
                    patch.object(module, 'package_state', return_value='clean'), \
                    patch.object(module, 'version_ok', return_value=True), \
                    patch.object(module, 'drained', side_effect=[None, 'empty-ControlGroup']), \
                    patch.object(module.os, 'geteuid', return_value=0), \
                    patch.object(module.sys, 'platform', 'linux'), \
                    patch.object(module.sys, 'stderr', output), \
                    patch.object(module.Path, 'is_file', return_value=True), \
                    patch.object(module.time, 'monotonic', side_effect=lambda: next(clock)), \
                    patch.object(module.time, 'sleep'):
                self.assertEqual(module.run('1h', work, '/private/status', ['true']), 0)

        self.assertEqual(output.getvalue().count('acquisition started\n'), 1)
        self.assertEqual(output.getvalue().count('acquisition finished\n'), 1)
        self.assertIn('Acquire::Retries "1";', output.getvalue())
        self.assertRegex(output.getvalue(), r'phase=installer-output elapsed-seconds=[0-9.]+')


if __name__ == '__main__':
    unittest.main()
