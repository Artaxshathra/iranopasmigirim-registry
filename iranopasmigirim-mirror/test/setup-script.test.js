'use strict';

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const setupScript = fs.readFileSync(path.join(ROOT, 'setup.sh'), 'utf8');

describe('setup.sh: registry command', () => {
  it('documents the optional SSH alias argument', () => {
    assert.match(setupScript, /registry OWNER REPO \[SSH_ALIAS\]/);
    assert.match(setupScript, /SSH_ALIAS: \(optional\) SSH config alias to use for git/);
  });

  it('forwards the SSH alias from main() into cmd_registry()', () => {
    assert.match(
      setupScript,
      /cmd_registry "\$\{2:-\}" "\$\{3:-\}" "\$\{4:-\}"/
    );
  });

  it('uses an alias-preserving SSH clone URL and refreshes origin', () => {
    assert.match(
      setupScript,
      /local clone_url="ssh:\/\/git@\$ssh_alias\/\$owner\/\$repo\.git"/
    );
    assert.match(setupScript, /git remote set-url origin "\$clone_url"/);
  });

  it('checks remote branches on origin and writes valid GitHub URLs', () => {
    assert.match(setupScript, /git ls-remote --exit-code --heads origin main/);
    assert.match(setupScript, /git ls-remote --exit-code --heads origin "\$branch"/);
    assert.match(setupScript, /local registry_public_url="https:\/\/github\.com\/\$owner\/\$repo"/);
    assert.match(setupScript, /"registry_url": "\$registry_public_url"/);
    assert.match(setupScript, /"api_base": "https:\/\/api\.github\.com\/repos\/\$owner\/\$repo"/);
    assert.match(
      setupScript,
      /"key_url": "https:\/\/raw\.githubusercontent\.com\/\$owner\/\$repo\/main\/keys\/producer-public\.asc"/
    );
  });

  it('seeds the default producer config from the registry setup context', () => {
    assert.match(setupScript, /producer_config_path_default\(\)/);
    assert.match(setupScript, /seed_default_producer_config_from_registry\(\)/);
    assert.match(
      setupScript,
      /local producer_config_path="\$\(producer_config_path_default\)"/
    );
    assert.match(
      setupScript,
      /seed_default_producer_config_from_registry "\$producer_config_path" "\$registry_public_url"/
    );
    assert.match(
      setupScript,
      /Default producer config registry_repo_url set to \$registry_url/
    );
  });
});

describe('setup.sh: dependency management', () => {
  it('detects supported package managers and can install missing prerequisites', () => {
    assert.match(setupScript, /detect_package_manager\(\)/);
    assert.match(setupScript, /for manager in apt-get dnf yum pacman zypper apk brew;/);
    assert.match(setupScript, /apt-get install -y --no-install-recommends/);
    assert.match(setupScript, /brew install "\$@"/);
  });

  it('preflights producer, registry, development, and verification dependencies', () => {
    assert.match(setupScript, /ensure_command_dependencies "Producer setup" python3 git gpg httrack/);
    assert.match(setupScript, /ensure_command_dependencies "Registry bootstrap" git python3 ssh/);
    assert.match(setupScript, /ensure_command_dependencies "Development environment" node npm/);
    assert.match(setupScript, /ensure_command_dependencies "Verification" node npm python3/);
  });

  it('installs Python TOML parser support when the runtime lacks tomllib', () => {
    assert.match(setupScript, /python_has_toml_parser\(\)/);
    assert.match(setupScript, /install_python_toml_parser\(\)/);
    assert.match(setupScript, /install_python_toml_parser_via_pip\(\)/);
    assert.match(setupScript, /python3 -m ensurepip --upgrade/);
    // pip install uses the active interpreter path resolved at runtime, not hardcoded python3
    assert.match(setupScript, /python_exe.*=.*command -v python3/);
    assert.match(setupScript, /\$python_exe.*-m pip install.*tomli/);
    assert.match(setupScript, /apt-get\|dnf\|yum\|zypper\)/);
    assert.match(setupScript, /package_name="python3-tomli"/);
    assert.match(setupScript, /ensure_python_toml_support "Producer setup"/);
    assert.match(setupScript, /ensure_python_toml_support "Verification"/);
  });
});

describe('setup.sh: producer command surface', () => {
  it('documents producer runtime and system subcommands', () => {
    assert.match(setupScript, /producer run-once \[CONFIG_PATH\]/);
    assert.match(setupScript, /producer daemon \[CONFIG_PATH\]/);
    assert.match(setupScript, /producer setup-system REGISTRY_REPO_URL SIGNING_KEY/);
    assert.match(setupScript, /producer status/);
    assert.match(setupScript, /producer logs \[LINES\]/);
  });

  it('dispatches producer subcommands to wrapped runtime helpers', () => {
    assert.match(setupScript, /cmd_producer_run_once\(\)/);
    assert.match(setupScript, /cmd_producer_daemon\(\)/);
    assert.match(setupScript, /cmd_producer_setup_system\(\)/);
    assert.match(setupScript, /cmd_producer_status\(\)/);
    assert.match(setupScript, /cmd_producer_logs\(\)/);
    assert.match(setupScript, /run_producer_cli_with_config run-once/);
    assert.match(setupScript, /run_producer_cli_with_config daemon/);
    assert.match(setupScript, /setup-system/);
    assert.match(setupScript, /--install-deps/);
    assert.match(setupScript, /run_privileged systemctl status mirror\.timer/);
    assert.match(setupScript, /run_privileged journalctl -u mirror\.service -n "\$lines" --no-pager/);
  });

  it('fails fast on merged subcommand-and-flag typos', () => {
    assert.match(setupScript, /\^\(doctor\|run-once\|daemon\|setup-system\|status\|logs\)--/);
    assert.match(setupScript, /did you mean to put a space before the flag\?/);
    assert.match(setupScript, /unknown producer subcommand or misplaced arguments/);
  });
});
