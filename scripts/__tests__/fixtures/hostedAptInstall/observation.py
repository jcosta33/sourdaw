"""Exercise the controller's fresh manager observation after a cgroup read race."""

import errno
import importlib.util
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('hosted', 'scripts/hostedAptInstall.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


def raising(*errors):
    """Raise each error in turn, then the last one forever, so a mutant never exhausts the reads."""
    remaining = list(errors)

    def read():
        raise remaining.pop(0) if len(remaining) > 1 else remaining[0]

    return read


class ObservationTest(unittest.TestCase):
    def run_controller(self, second, reads):
        invocation = 'a' * 32
        shows = []
        actions = []
        clock = iter(range(1000))

        def manager(action, *args):
            actions.append(action)
            if action != 'show':
                return ''
            unit = args[0]
            fields = {
                'Id': unit, 'Description': f'Sourdaw hosted apt {unit}',
                'InvocationID': invocation, 'LoadState': 'loaded', 'Type': 'exec',
                'ExitType': 'cgroup', 'RemainAfterExit': 'yes', 'CollectMode': 'inactive',
                'KillMode': 'control-group', 'RuntimeMaxUSec': '1s',
                'ActiveState': 'active', 'SubState': 'exited', 'Result': 'success',
                'ExecMainCode': '1', 'ExecMainStatus': '0',
                'ControlGroup': f'/system.slice/{unit}',
            }
            if shows:
                fields.update(second)
            shows.append(fields)
            return '\n'.join(f'{key}={value}' for key, value in fields.items())

        with tempfile.TemporaryDirectory() as directory, \
                patch.object(module, 'manager', side_effect=manager), \
                patch.object(module, 'package_state', return_value='clean'), \
                patch.object(module, 'version_ok', return_value=True), \
                patch.object(module.os, 'geteuid', return_value=0), \
                patch.object(module.sys, 'platform', 'linux'), \
                patch.object(module.Path, 'is_file', return_value=True), \
                patch.object(module.Path, 'read_text', side_effect=reads), \
                patch.object(module, 'report_log'), \
                patch.object(module, 'command', return_value=subprocess.CompletedProcess([], 0, '', '')), \
                patch.object(module.time, 'monotonic', side_effect=lambda: next(clock)), \
                patch.object(module.time, 'sleep'):
            try:
                outcome = module.run('1s', Path(directory), '/private/status', ['true'])
            except module.Unproven as error:
                outcome = str(error)
        return outcome, shows, actions

    def test_missing_path_needs_fresh_positive_witness(self):
        outcome, shows, actions = self.run_controller({'ControlGroup': ''}, [FileNotFoundError()])
        self.assertEqual(outcome, 0)
        self.assertGreaterEqual(len(shows), 2)
        self.assertEqual(shows[0]['InvocationID'], shows[1]['InvocationID'])
        self.assertIn('stop', actions)

    def test_fresh_empty_cgroup_is_also_a_witness(self):
        outcome, shows, actions = self.run_controller({}, [FileNotFoundError(), 'populated 0\n'])
        self.assertEqual(outcome, 0)
        self.assertGreaterEqual(len(shows), 2)
        self.assertEqual(shows[0]['InvocationID'], shows[1]['InvocationID'])
        self.assertIn('stop', actions)

    def test_missing_path_alone_never_proves_drain(self):
        outcome, shows, actions = self.run_controller({}, lambda: (_ for _ in ()).throw(FileNotFoundError()))
        self.assertIn('bounded observation limit', outcome)
        self.assertGreater(len(shows), 1)
        self.assertNotIn('stop', actions)

    def test_changed_invocation_fails_closed(self):
        outcome, _, actions = self.run_controller({'InvocationID': 'b' * 32}, [FileNotFoundError()])
        self.assertIn('invocation changed or disappeared', outcome)
        self.assertNotIn('stop', actions)

    def test_disappeared_unit_fails_closed(self):
        outcome, _, actions = self.run_controller({'Id': ''}, [FileNotFoundError()])
        self.assertIn('identity changed or disappeared', outcome)
        self.assertNotIn('stop', actions)

    def test_unreadable_cgroup_fails_closed(self):
        outcome, _, actions = self.run_controller({}, [FileNotFoundError(), PermissionError('denied')])
        self.assertIn('cgroup status unavailable', outcome)
        self.assertNotIn('stop', actions)

    def test_device_gone_mid_read_needs_fresh_positive_witness(self):
        gone = OSError(errno.ENODEV, 'No such device')
        outcome, shows, actions = self.run_controller({'ControlGroup': ''}, [gone])
        self.assertEqual(outcome, 0)
        self.assertGreaterEqual(len(shows), 2)
        self.assertEqual(shows[0]['InvocationID'], shows[1]['InvocationID'])
        self.assertIn('stop', actions)

    def test_fresh_empty_cgroup_after_device_gone_is_also_a_witness(self):
        gone = OSError(errno.ENODEV, 'No such device')
        outcome, shows, actions = self.run_controller({}, [gone, 'populated 0\n'])
        self.assertEqual(outcome, 0)
        self.assertGreaterEqual(len(shows), 2)
        self.assertEqual(shows[0]['InvocationID'], shows[1]['InvocationID'])
        self.assertIn('stop', actions)

    def test_device_gone_alone_never_proves_drain(self):
        def gone():
            raise OSError(errno.ENODEV, 'No such device')

        outcome, shows, actions = self.run_controller({}, gone)
        self.assertIn('bounded observation limit', outcome)
        self.assertGreater(len(shows), 1)
        self.assertNotIn('stop', actions)

    def test_changed_invocation_after_device_gone_fails_closed(self):
        gone = OSError(errno.ENODEV, 'No such device')
        outcome, _, actions = self.run_controller({'InvocationID': 'b' * 32}, [gone])
        self.assertIn('invocation changed or disappeared', outcome)
        self.assertNotIn('stop', actions)

    def test_other_errno_fails_closed_on_the_first_read(self):
        denied = OSError(errno.EACCES, 'Permission denied')
        outcome, shows, actions = self.run_controller({}, raising(denied))
        self.assertIn('owned cgroup status unavailable', outcome)
        self.assertIn('Permission denied', outcome)
        self.assertEqual(len(shows), 1)
        self.assertNotIn('stop', actions)

    def test_malformed_cgroup_events_fail_closed_on_the_first_read(self):
        outcome, shows, actions = self.run_controller({}, lambda: 'populated\n')
        self.assertIn('owned cgroup status unavailable', outcome)
        self.assertEqual(len(shows), 1)
        self.assertNotIn('stop', actions)

    def test_unreadable_cgroup_after_device_gone_reports_the_later_error(self):
        gone = OSError(errno.ENODEV, 'No such device')
        outcome, shows, actions = self.run_controller({}, raising(gone, OSError(errno.EIO, 'Input/output error')))
        self.assertIn('owned cgroup status unavailable', outcome)
        self.assertIn('Input/output error', outcome)
        self.assertNotIn('No such device', outcome)
        self.assertEqual(len(shows), 2)
        self.assertNotIn('stop', actions)


if __name__ == '__main__':
    unittest.main()
