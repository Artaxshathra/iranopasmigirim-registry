---
description: "Review: assessing the idea with Gemini + Codex + Sonnet (sonet), then deep synthesis and implementation plan"
---
You are running a high-rigor architecture review for an idea/proposal.

Primary objective:
- Produce a deeply accurate, security-first, correctness-first assessment and then a concrete execution plan.

Required orchestration:
1. Spawn 3 separate subagent assessments using `runSubagent` with these model intents:
- Gemini (use a Gemini-class model if available)
- Codex (use a Codex/GPT-5.3-Codex-class model if available)
- Sonnet/sonet (use a Claude Sonnet-class model if available)
2. Each subagent must independently review against project reality and fundamentals (current codebase, architecture, security model, constraints, deployment context).
3. If a requested model is unavailable, use the closest available model and explicitly note the substitution.

Subagent prompt requirements (for each reviewer):
- Assess: correctness, feasibility, best practices, cleanliness, safety/security, efficiency/performance, maintainability/readability, operational risk.
- Identify: assumptions, hidden coupling, edge cases, failure modes, threat model gaps, rollback/migration risks.
- Provide: severity-ranked findings with concrete file/symbol references where applicable.
- Return: a scored verdict (0-10) for each dimension and a concise recommendation.

Synthesis phase (mandatory, done by you after collecting all 3 reviews):
1. Build a merged findings matrix:
- Columns: topic, Gemini, Codex, Sonnet, consensus, disagreement, evidence quality.
2. Perform a second intense review pass on the 3 outputs:
- Challenge weak claims, remove speculation, reconcile contradictions with code evidence.
3. Produce an extensive final plan:
- Prioritized phases (P0/P1/P2)
- Explicit acceptance criteria per phase
- Test strategy (unit/integration/security/regression)
- Rollback/safe deployment strategy
- Residual risk register and monitoring hooks

Output format (strict):
1. Executive verdict
2. Cross-model findings (severity-ordered)
3. Consensus and disagreements
4. Deep second-pass critique
5. Extensive implementation plan
6. Validation checklist
7. Open questions/blockers

Quality bar:
- Be explicit, evidence-backed, and implementation-oriented.
- Prefer concrete references to generic advice.
- Security and correctness outweigh convenience.
