import sys
import unittest
from pathlib import Path
from unittest.mock import patch

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from mirror_and_push import (  # type: ignore
    Config,
    DEFAULT_CONFIG,
    current_head_sha,
    detect_linux_package_manager,
    ensure_pip_for_active_python,
    has_toml_parser,
    install_tomli_for_active_python,
    is_host_allowed,
    is_payment_url,
    is_stream_url,
    maybe_install_deps,
    normalize_host,
    package_names_for_tools,
    parse_request_doc,
    replace_config_assignment,
    rollback_delivery_checkout,
    sanitize_html_text,
    sanitize_relpath,
    stage_commit_and_push_with_rollback,
    status_file_path,
    validate_branch_name,
)


class ProducerParsingTests(unittest.TestCase):
    def make_cfg(self) -> Config:
        return Config(
            registry_repo_path=Path('/tmp/registry'),
            registry_repo_url='https://github.com/example/registry',
            registry_remote='origin',
            registry_branch='registrations',
            requests_subdir='requests',
            status_subdir='status',
            user_repos_root=Path('/tmp/users'),
            delivery_subdir='',
            default_delivery_branch='content',
            default_entry_path='index.html',
            interval_minutes=15,
            max_requests_per_run=10,
            signing_key='0xABCDEF1234567890',
            gpg_passphrase_env='GPG_PASSPHRASE',
            user_agent='ua',
            exclude_patterns=[],
            min_files=1,
            max_files=2000,
            whitelist_hosts=['bbc.com', 'cnn.com'],
            maintenance_interval_hours=24,
            prune_after_days=30,
            block_stream_extensions=['.m3u8'],
            block_payment_domains=['paypal.com'],
        )

    def test_normalize_host(self):
        self.assertEqual(normalize_host('www.BBC.com'), 'bbc.com')
        self.assertEqual(normalize_host('cnn.com'), 'cnn.com')

    def test_sanitize_relpath(self):
        self.assertEqual(sanitize_relpath('a/b/c.txt'), 'a/b/c.txt')
        with self.assertRaises(SystemExit):
            sanitize_relpath('/abs/path.txt')
        with self.assertRaises(SystemExit):
            sanitize_relpath('../escape.txt')

    def test_parse_request_doc_valid(self):
        cfg = self.make_cfg()
        req = parse_request_doc({
            'requestId': 'req-123456-aa11bb',
            'userRepoUrl': 'https://github.com/example/userrepo',
            'requestedUrl': 'https://bbc.com/news',
            'siteHost': 'bbc.com',
            'ownership': {
                'branch': 'requests',
                'challengePath': '_mirror/challenges/req-123456-aa11bb.txt',
                'nonce': 'abcd',
            },
            'delivery': {
                'branch': 'content',
                'manifestPath': '_mirror/manifest.json',
            },
        }, cfg)

        self.assertEqual(req.request_id, 'req-123456-aa11bb')
        self.assertEqual(req.site_host, 'bbc.com')
        self.assertEqual(req.delivery_branch, 'content')

    def test_parse_request_doc_invalid_host_url(self):
        cfg = self.make_cfg()
        with self.assertRaises(SystemExit):
            parse_request_doc({
                'requestId': 'req-123456-aa11bb',
                'userRepoUrl': 'https://github.com/example/userrepo',
                'requestedUrl': 'http://bbc.com/news',
                'ownership': {
                    'branch': 'requests',
                    'challengePath': '_mirror/challenges/a.txt',
                    'nonce': 'x',
                },
            }, cfg)

    def test_is_host_allowed(self):
        cfg = self.make_cfg()
        self.assertTrue(is_host_allowed('bbc.com', cfg))
        self.assertTrue(is_host_allowed('www.cnn.com', cfg))
        self.assertFalse(is_host_allowed('example.com', cfg))

    def test_status_file_path(self):
        cfg = self.make_cfg()
        p = status_file_path(cfg, 'req/invalid*id')
        self.assertEqual(str(p), '/tmp/registry/status/req_invalid_id.json')

    def test_validate_branch_name_rejects_ref_syntax(self):
        self.assertEqual(validate_branch_name('content'), 'content')
        with self.assertRaises(SystemExit):
            validate_branch_name('content@{1}')
        with self.assertRaises(SystemExit):
            validate_branch_name('content~1')

    def test_replace_config_assignment_updates_matching_key(self):
        updated = replace_config_assignment(
            DEFAULT_CONFIG,
            'signing_key',
            '"0xABCDEF1234567890"',
        )
        self.assertIn('signing_key = "0xABCDEF1234567890"', updated)
        self.assertNotIn('signing_key = "0xDD13EC3368AA05D1"', updated)

    def test_payment_url_domain_matching_is_host_based(self):
        blocked = ['paypal.com', 'zarinpal.com']
        self.assertTrue(is_payment_url('https://paypal.com/checkout', blocked))
        self.assertTrue(is_payment_url('https://www.paypal.com/checkout', blocked))
        self.assertTrue(is_payment_url('https://api.paypal.com/v1', blocked))
        self.assertFalse(is_payment_url('https://example.com/?q=paypal.com', blocked))
        self.assertFalse(is_payment_url('not a url', blocked))

    def test_stream_url_matching_uses_path_suffix(self):
        blocked = ['.m3u8', '.mpd']
        self.assertTrue(is_stream_url('https://cdn.example.com/live/playlist.m3u8', blocked))
        self.assertFalse(is_stream_url('https://cdn.example.com/readme.m3u8.txt', blocked))
        self.assertFalse(is_stream_url('https://example.com/?file=video.m3u8', blocked))

    def test_sanitize_html_text_removes_active_content(self):
        cfg = self.make_cfg()
        html = (
            '<html><head><script>alert(1)</script><meta http-equiv="refresh" content="0;url=https://evil"></head>'
            '<body><a href="javascript:alert(1)">x</a><img src="x" onerror="alert(1)">'
            '<form action="/pay"></form></body></html>'
        )
        out = sanitize_html_text(html, cfg)
        self.assertNotIn('<script', out.lower())
        self.assertNotIn('http-equiv="refresh"', out.lower())
        self.assertNotIn(' onerror=', out.lower())
        self.assertIn('/__mirror_blocked.html?reason=active-content', out)
        self.assertIn('/__mirror_blocked.html?reason=form', out)


class ProducerRollbackTests(unittest.TestCase):
    def test_stage_commit_and_push_with_rollback_triggers_cleanup_on_failure(self):
        with patch('mirror_and_push.current_head_sha', return_value='deadbeef') as head_mock, \
                patch('mirror_and_push.stage_commit_and_push', side_effect=RuntimeError('push failed')) as commit_mock, \
                patch('mirror_and_push.rollback_delivery_checkout') as rollback_mock:
            with self.assertRaises(RuntimeError):
                stage_commit_and_push_with_rollback(
                    repo_path=Path('/tmp/repo'),
                    remote='origin',
                    branch='content',
                    signing_key='0xABCDEF1234567890',
                    pass_env='GPG_PASSPHRASE',
                    message='deliver test',
                )
            head_mock.assert_called_once()
            commit_mock.assert_called_once()
            rollback_mock.assert_called_once_with(Path('/tmp/repo'), 'deadbeef')

    def test_stage_commit_and_push_with_rollback_passthrough_on_success(self):
        with patch('mirror_and_push.current_head_sha', return_value='deadbeef'), \
                patch('mirror_and_push.stage_commit_and_push', return_value='cafebabe') as commit_mock, \
                patch('mirror_and_push.rollback_delivery_checkout') as rollback_mock:
            out = stage_commit_and_push_with_rollback(
                repo_path=Path('/tmp/repo'),
                remote='origin',
                branch='content',
                signing_key='0xABCDEF1234567890',
                pass_env='GPG_PASSPHRASE',
                message='deliver test',
            )
            self.assertEqual(out, 'cafebabe')
            commit_mock.assert_called_once()
            rollback_mock.assert_not_called()

    def test_current_head_sha_returns_none_when_repo_has_no_head(self):
        with patch('mirror_and_push.subprocess.run') as run_mock:
            run_mock.return_value.returncode = 1
            run_mock.return_value.stdout = ''
            self.assertIsNone(current_head_sha(Path('/tmp/repo')))

    def test_rollback_checkout_uses_reset_and_clean(self):
        with patch('mirror_and_push.run') as run_mock:
            rollback_delivery_checkout(Path('/tmp/repo'), 'abc123')
            self.assertEqual(run_mock.call_count, 2)


class ProducerDependencyInstallTests(unittest.TestCase):
    def test_detect_linux_package_manager_prefers_first_supported_option(self):
        def fake_which(name):
            if name == 'dnf':
                return f'/usr/bin/{name}'
            return None

        with patch('mirror_and_push.shutil.which', side_effect=fake_which):
            self.assertEqual(detect_linux_package_manager(), 'dnf')

    def test_package_names_for_tools_maps_linux_package_names(self):
        self.assertEqual(
            package_names_for_tools('apt-get', ['python3', 'git', 'gpg', 'httrack', 'tomli']),
            ['python3', 'git', 'gnupg', 'httrack', 'python3-tomli'],
        )
        self.assertEqual(
            package_names_for_tools('pacman', ['python3', 'gpg', 'git', 'tomli']),
            ['python', 'gnupg', 'git', 'python-tomli'],
        )

    def test_has_toml_parser_false_when_both_modules_are_missing(self):
        import builtins

        real_import = builtins.__import__

        def fake_import(name, *args, **kwargs):
            if name in ('tomllib', 'tomli'):
                raise ModuleNotFoundError(name)
            return real_import(name, *args, **kwargs)

        with patch('builtins.__import__', side_effect=fake_import):
            self.assertFalse(has_toml_parser())

    def test_ensure_pip_for_active_python_uses_existing_pip(self):
        with patch('mirror_and_push.subprocess.run') as run_mock:
            run_mock.return_value.returncode = 0
            ensure_pip_for_active_python()
            run_mock.assert_called_once_with(
                [sys.executable, '-m', 'pip', '--version'],
                stdout=unittest.mock.ANY,
                stderr=unittest.mock.ANY,
                text=True,
            )

    def test_install_tomli_for_active_python_uses_user_install_when_not_root(self):
        with patch('mirror_and_push.ensure_pip_for_active_python') as ensure_pip_mock, \
                patch('mirror_and_push.os.geteuid', return_value=1000), \
                patch('mirror_and_push.run') as run_mock:
            install_tomli_for_active_python()

        ensure_pip_mock.assert_called_once()
        run_mock.assert_called_once_with([sys.executable, '-m', 'pip', 'install', '--user', 'tomli'])

    def test_maybe_install_deps_uses_pacman_when_available(self):
        def fake_which(name):
            if name == 'pacman':
                return f'/usr/bin/{name}'
            return None

        with patch('mirror_and_push.shutil.which', side_effect=fake_which), \
                patch('mirror_and_push.has_toml_parser', side_effect=[False, True]), \
                patch('mirror_and_push.run') as run_mock:
            maybe_install_deps()

        self.assertEqual(run_mock.call_count, 2)
        run_mock.assert_any_call(['pacman', '-Sy', '--noconfirm'])
        run_mock.assert_any_call(['pacman', '-S', '--needed', '--noconfirm', 'python', 'git', 'gnupg', 'httrack', 'python-tomli'])

    def test_maybe_install_deps_skips_tomli_when_python_already_has_toml_parser(self):
        def fake_which(name):
            if name == 'apt-get':
                return f'/usr/bin/{name}'
            return None

        with patch('mirror_and_push.shutil.which', side_effect=fake_which), \
                patch('mirror_and_push.has_toml_parser', return_value=True), \
                patch('mirror_and_push.run') as run_mock:
            maybe_install_deps()

        run_mock.assert_any_call(['apt-get', 'update'])
        run_mock.assert_any_call(['apt-get', 'install', '-y', '--no-install-recommends', 'python3', 'git', 'gnupg', 'httrack'])

    def test_maybe_install_deps_falls_back_to_pip_when_package_install_does_not_fix_active_python(self):
        def fake_which(name):
            if name == 'apt-get':
                return f'/usr/bin/{name}'
            return None

        with patch('mirror_and_push.shutil.which', side_effect=fake_which), \
                patch('mirror_and_push.has_toml_parser', side_effect=[False, False]), \
                patch('mirror_and_push.install_tomli_for_active_python') as install_tomli_mock, \
                patch('mirror_and_push.run') as run_mock:
            maybe_install_deps()

        run_mock.assert_any_call(['apt-get', 'update'])
        run_mock.assert_any_call(['apt-get', 'install', '-y', '--no-install-recommends', 'python3', 'git', 'gnupg', 'httrack', 'python3-tomli'])
        install_tomli_mock.assert_called_once()

    def test_maybe_install_deps_fails_without_supported_package_manager(self):
        with patch('mirror_and_push.shutil.which', return_value=None):
            with self.assertRaisesRegex(SystemExit, 'no supported Linux package manager'):
                maybe_install_deps()


if __name__ == '__main__':
    unittest.main()
