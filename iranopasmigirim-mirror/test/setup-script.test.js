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
