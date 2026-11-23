"""Offline policy regressions. No Maven, Docker, Java or network is executed."""
import contextlib
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch

ROOT = Path(__file__).resolve().parents[1]
os.environ['STG_1A_REPO_ROOT'] = str(ROOT)
source = (ROOT / 'scripts/stg-1a-verify.sh').read_text()
verifier = {'__name__': 'stg_1a_policy_subject'}
exec(compile(source.split("<<'PY'\n", 1)[1].rsplit('\nPY', 1)[0],
             'stg-1a-verify.sh:python', 'exec'), verifier)


class PreMavenPolicy(unittest.TestCase):
    def reject_without_launch(self, environment=None, arguments=None):
        launches = Mock(side_effect=AssertionError('Unauthorized external launch'))
        with patch.dict(os.environ, environment or {}, clear=True), \
                patch('subprocess.check_output', launches), \
                patch('subprocess.run', launches), \
                patch.dict(verifier, {'run': launches}):
            with self.assertRaisesRegex(ValueError, 'AUTHORIZATION BLOCKED.*independently controlled'):
                if arguments is None:
                    verifier['build']({})
                else:
                    with patch('sys.argv', ['verify', *arguments]):
                        verifier['main']()
            self.assertEqual(launches.call_count, 0, 'Rejection must precede every external process')

    def test_unknown_approval_fails_closed(self):
        self.reject_without_launch()

    def test_socket_is_not_approval(self):
        self.reject_without_launch({'DOCKER_HOST': 'unix:///var/run/docker.sock'})

    def test_explicit_privileged_ryuk_rejected(self):
        self.reject_without_launch({'TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED': 'true'})

    def test_nonprivileged_ryuk_is_not_approval(self):
        self.reject_without_launch({'TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED': 'false'})

    def test_misspelled_privilege_variable_is_not_approval(self):
        self.reject_without_launch({'TESTCONTAINERS_RYUK_PRIVILEGED': 'false'})

    def test_disabled_ryuk_requires_independent_cleanup_approval(self):
        self.reject_without_launch({'TESTCONTAINERS_RYUK_DISABLED': 'true'})

    def test_self_attested_cleanup_cannot_grant_approval(self):
        self.reject_without_launch({'TESTCONTAINERS_RYUK_DISABLED': 'true',
                                    'STG_1A_CLEANUP_APPROVED': 'true',
                                    'STG_1A_PLATFORM_APPROVED': 'true'})

    def test_invalid_or_conflicting_overrides_fail_closed(self):
        for value in ('', 'unknown', 'false,true', 'TRUE', ' true '):
            with self.subTest(value=value):
                self.reject_without_launch({'TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED': value,
                                            'TESTCONTAINERS_RYUK_PRIVILEGED': 'false',
                                            'TESTCONTAINERS_RYUK_DISABLED': 'true'})

    def test_untrusted_home_and_classpath_properties_cannot_grant_approval(self):
        with tempfile.TemporaryDirectory(prefix='stg-1a-policy-') as directory:
            home = Path(directory)
            (home / '.testcontainers.properties').write_text('ryuk.container.privileged=false\n')
            (home / 'testcontainers.properties').write_text('ryuk.container.privileged=true\n')
            with patch.dict(verifier, {'ROOT': home}), patch.object(Path, 'home', return_value=home):
                self.reject_without_launch({'TESTCONTAINERS_RYUK_CONTAINER_PRIVILEGED': 'false',
                                            'CLASSPATH': str(home)})

    def test_untrusted_approval_file_cannot_grant_approval(self):
        with tempfile.TemporaryDirectory(prefix='stg-1a-approval-') as directory:
            candidate = Path(directory) / 'approval.json'
            candidate.write_text('{"approved":true,"cleanup_approved":true}')
            self.reject_without_launch({'STG_1A_APPROVAL_FILE': str(candidate)})

    def test_cli_intent_flag_cannot_grant_approval(self):
        self.reject_without_launch(arguments=['build', '--authorized-execution'])

    def test_cli_without_intent_flag_fails_closed(self):
        self.reject_without_launch(arguments=['build'])

    def test_no_evidence_changes_before_rejection(self):
        with tempfile.TemporaryDirectory(prefix='stg-1a-evidence-') as directory:
            evidence = Path(directory)
            record = evidence / 'jar-provenance.json'
            record.write_text('preserved prior evidence')
            with patch.dict(verifier, {'EVIDENCE': evidence}):
                self.reject_without_launch()
            self.assertEqual(record.read_text(), 'preserved prior evidence')
            self.assertEqual(list(evidence.iterdir()), [record])

    def test_static_cli_remains_separate_from_workload_gate(self):
        static = Mock(return_value={})
        gate = Mock(side_effect=AssertionError('Static mode requested workload authorization'))
        with patch.dict(verifier, {'static_checks': static,
                                   'require_testcontainers_authorization': gate}), \
                patch('sys.argv', ['verify', 'static']), contextlib.redirect_stdout(io.StringIO()):
            verifier['main']()
        static.assert_called_once()
        gate.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
