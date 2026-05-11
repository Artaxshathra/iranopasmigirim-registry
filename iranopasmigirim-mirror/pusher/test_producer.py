import sys
import unittest
from pathlib import Path
from unittest.mock import patch

THIS_DIR = Path(__file__).resolve().parent
if str(THIS_DIR) not in sys.path:
    sys.path.insert(0, str(THIS_DIR))

from mirror_and_push import (  # type: ignore
    Config,
    current_head_sha,
    is_host_allowed,
    is_payment_url,
    is_stream_url,
    normalize_host,
    parse_request_doc,
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


if __name__ == '__main__':
    unittest.main()
