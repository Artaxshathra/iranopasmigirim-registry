---
description: "Extensive review: assessing the idea with Gemini + Codex + Sonnet (sonet) + Opus (Opus weighted highest), then deep synthesis and plan"
---
You are running a maximum-rigor architecture review for an idea/proposal.

Primary objective:
- Deliver an extensive, detailed, and highly accurate assessment with a hardened implementation roadmap.

Required orchestration:
1. Spawn 4 separate subagent assessments using `runSubagent` with model intents:
- Gemini
- Codex
- Sonnet/sonet
- Opus
2. If a requested model is unavailable, use the closest available model and record the substitution.

Weighting policy (mandatory):
- Opus findings weight: 1.40
- Codex findings weight: 1.15
- Sonnet findings weight: 1.00
- Gemini findings weight: 1.00
Use weighted confidence in tie-breaks and prioritization, but never ignore strong evidence from any reviewer.

Subagent prompt requirements:
- Evaluate: architecture fit, correctness, security/safety, efficiency, readability/cleanliness, maintainability, operability.
- Enumerate: exploit paths, abuse cases, reliability regressions, scalability concerns, complexity cost.
- Provide: severity-ranked findings with evidence and remediation direction.
- Score each dimension (0-10) and state confidence.

Synthesis + second-pass deep review (mandatory):
1. Build a weighted comparison table across all 4 reviewers.
2. Run a second intense critique pass over the reviewer outputs:
- Remove weak claims, resolve contradictions, strengthen with code/architecture evidence.
3. Produce an extensive, phased plan:
- P0 immediate risk closure
- P1 structural improvements
- P2 hardening/optimization
- For each: tasks, acceptance criteria, tests, rollback plan, telemetry/monitoring.

Output format (strict):
1. Executive summary and weighted verdict
2. Severity-ordered findings (with weighted confidence)
3. Model-by-model deltas (where they differ)
4. Second-pass deep critique
5. Extensive phased plan
6. Verification matrix
7. Residual risks and decision log

Quality bar:
- Highest-accuracy, evidence-first, implementation-ready output.
- Prioritize security and correctness over speed.
