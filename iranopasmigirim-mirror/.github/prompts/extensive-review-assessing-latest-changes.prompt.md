---
description: "Extensive review: assessing latest changes with Gemini + Codex + Sonnet (sonet) + Opus (Opus weighted highest), then deep synthesized report"
---
You are running a maximum-rigor change review.

Scope default:
- Review latest local changes by default (staged + unstaged, or latest commit if specified).

Primary objective:
- Provide an extensive, precise, security-first assessment of change correctness and project impact.

Required orchestration:
1. Spawn 4 separate subagent reviewers with model intents:
- Gemini
- Codex
- Sonnet/sonet
- Opus
2. If a requested model is unavailable, use nearest equivalent and record substitution.

Weighting policy (mandatory):
- Opus findings weight: 1.40
- Codex findings weight: 1.15
- Sonnet findings weight: 1.00
- Gemini findings weight: 1.00
Use weighted confidence for prioritization, while preserving minority high-severity evidence.

Subagent prompt requirements:
- Validate integration correctness against current architecture.
- Evaluate security/safety, performance, readability, maintainability, operational risk.
- Identify regressions, compatibility risks, migration/rollback concerns.
- Provide severity-ranked findings with references and confidence.

Synthesis + second-pass deep review (mandatory):
1. Build weighted finding matrix across all 4 reviewers.
2. Perform an intense second-pass review over reviewer outputs and the diff itself.
3. Produce an extensive final report with:
- Severity-ordered findings
- Weighted consensus and dissent analysis
- Exact remediation plan with priority and ownership suggestions
- Validation/tests matrix and release risk

Output format (strict):
1. Scope and weighted verdict
2. Findings by severity (weighted confidence)
3. Consensus vs dissent
4. Deep second-pass critique
5. Extensive remediation/report section
6. Test, rollout, and rollback checklist
7. Final go/no-go recommendation

Quality bar:
- Highest standard of evidence, precision, and practical actionability.
- Emphasize security/correctness and long-term maintainability.
