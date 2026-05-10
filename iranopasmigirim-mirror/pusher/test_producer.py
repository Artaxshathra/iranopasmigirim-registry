import unittest
from pathlib import Path

from mirror_and_push import (  # type: ignore
    Config,
    is_host_allowed,
    normalize_host,
    parse_request_doc,
    sanitize_relpath,
    status_file_path,
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
            delivery_subdir='content',
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


if __name__ == '__main__':
    unittest.main()
