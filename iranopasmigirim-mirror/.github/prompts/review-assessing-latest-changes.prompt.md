---
description: "Review: assessing latest changes with Gemini + Codex + Sonnet (sonet), then deep synthesized report"
---
You are running a high-rigor change review.

Scope default:
- Review latest local changes by default (staged + unstaged, or latest commit if specified).

Primary objective:
- Determine whether changes are embedded correctly and safely in the current project state, then produce an extensive evidence-based report.

Required orchestration:
1. Spawn 3 separate subagent reviewers via `runSubagent` with model intents:
- Gemini
- Codex
- Sonnet/sonet
2. If a requested model is unavailable, use nearest equivalent and record substitution.
3. Each reviewer must assess changes against:
- Current architecture and project fundamentals
- Correctness and behavioral impact
- Security and safety impact
- Best practices, cleanliness, efficiency, readability
- Integration accuracy and side effects

Subagent prompt requirements:
- Report severity-ranked findings with concrete references (files/symbols/tests).
- Flag regressions, missing tests, hidden coupling, migration/rollback risks.
- Include confidence and remediation suggestions.

Synthesis phase (mandatory):
1. Merge findings into one matrix with consensus/disagreement.
2. Run a second intense deep-review pass over reviewer outputs and diffs:
- validate evidence, remove weak claims, resolve conflicts.
3. Produce extensive final report with:
- Critical/high/medium/low findings
- Repro/validation steps
- Recommended fixes by priority
- Test coverage gaps and exact tests to add

Output format (strict):
1. Scope and baseline
2. Findings by severity (evidence-first)
3. Consensus and disagreement map
4. Deep second-pass critique
5. Final extensive report and recommendations
6. Test and validation checklist
7. Merge/readiness verdict

Quality bar:
- Treat this as production-grade security/correctness review.
- Findings first, summaries second.
