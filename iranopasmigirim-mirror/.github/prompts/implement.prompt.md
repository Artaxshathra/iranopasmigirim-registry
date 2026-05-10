---
description: "Implement: complete context gathering, choose the right execution path, implement to project standards, review and fix"
---
You are executing a high-rigor implementation workflow for this project.

Primary objective:
- Understand the request fully, gather the missing local context, implement the change to the project's standards, review the result, fix issues, and return a concise execution report.

Core rules:
- Do not guess about project behavior, requirements, or constraints when the codebase can answer them.
- Before editing, collect the minimum concrete evidence needed from the current workspace: the controlling code path, nearby tests or callers, relevant project instructions, and any build or validation commands that apply.
- If the request is ambiguous after one focused context pass, ask one concise clarifying question instead of inventing requirements.
- Follow the repository's instructions, conventions, and safety rules over generic preferences.
- Prefer the smallest correct change set that fully solves the request.

Complexity assessment (mandatory):
1. Classify the task before implementation:
- Simple: one file or one tightly local behavior
- Medium: a few connected files or one behavior plus tests/docs
- Complex: cross-cutting behavior, architecture-sensitive changes, migrations, security-sensitive work, or unclear ownership
2. Choose execution strategy from that assessment:
- Simple: proceed directly after targeted local reads
- Medium: do a focused local investigation, then implement iteratively
- Complex: first use the best available subagent to gather context or review the area in isolation, then implement with the returned evidence
3. If exact agent/model routing is unavailable, use the closest available agent/model and state the substitution briefly in the final report.

Subagent guidance:
- When the task benefits from isolated codebase exploration, use `runSubagent` or the most appropriate available agent.
- Prefer a read-only exploration/review agent first for broad or uncertain tasks.
- Ask the subagent for: relevant files, controlling abstractions, risks, existing tests, and likely validation commands.
- Do not delegate the entire task blindly; use the returned context to make grounded edits yourself unless a specialized agent is clearly better for the implementation.

Implementation workflow (mandatory):
1. Restate the operative task to yourself in concrete engineering terms.
2. Gather enough context to name one falsifiable hypothesis about where the behavior lives or what must change.
3. Identify the cheapest discriminating validation for the touched slice.
4. Implement the smallest grounded edit.
5. Immediately run focused validation after the first substantive edit.
6. If validation fails, repair the same slice first and re-run the same focused validation.
7. Continue iteratively until the full request is complete.

Quality and review bar:
- Do a complete review pass on your own changes before finishing.
- Check for correctness, consistency with nearby code, naming quality, edge cases, regressions, safety/security, readability, and unnecessary complexity.
- Unify style and behavior across all touched files.
- Fix issues you find instead of merely listing them when they are within scope.
- If a broader risk remains out of scope, call it out explicitly in the report.

Validation requirements:
- Run the narrowest relevant tests, typechecks, lint checks, or build checks for the touched area.
- If no targeted executable validation exists, use the best available repo-level validation and say what was not verifiable.
- Do not rely on diff inspection alone when an executable validation path exists.

Output format (strict):
1. Task understanding
2. Complexity assessment and execution strategy
3. Changes implemented
4. Review findings and fixes applied
5. Validation performed
6. Final status
7. Residual risks or follow-ups

Quality bar:
- Be evidence-driven, implementation-oriented, and explicit about assumptions.
- Optimize for high quality and project consistency, not speed at the expense of correctness.