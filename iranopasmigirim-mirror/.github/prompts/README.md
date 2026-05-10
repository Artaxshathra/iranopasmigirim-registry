# Project Prompt Workflows

These prompt files are reusable workflows for high-rigor review and implementation tasks.

## Available Prompts

- `Review: Assessing The Idea`
- `Extensive Review: Assessing The Idea`
- `Review: Assessing Changes (Latest By Default)`
- `Extensive Review: Assessing Changes (Latest By Default)`
- `Implement`

## How To Run

1. Open Copilot Chat in VS Code.
2. Type `/` and select one of the prompts above.
3. Provide the idea text or change scope when prompted.

If prompts do not appear in `/`:
1. Run `Developer: Reload Window` once.
2. Re-open Copilot Chat and type `/` again.
3. Use command palette: `Chat: Run Prompt...` and pick from workspace prompts.

## Behavior Notes

- The standard prompts orchestrate 3 reviewer passes: Gemini, Codex, Sonnet.
- The extensive prompts orchestrate 4 reviewer passes: Gemini, Codex, Sonnet, Opus.
- Extensive prompts apply higher weighting to Opus outputs during synthesis.
- All prompts require a second intense synthesis pass before final output.
- The implement prompt performs scoped context gathering, complexity assessment, targeted execution, self-review, fixes, and validation before reporting.

## Files

- `.github/prompts/review-assessing-idea.prompt.md`
- `.github/prompts/extensive-review-assessing-idea.prompt.md`
- `.github/prompts/review-assessing-latest-changes.prompt.md`
- `.github/prompts/extensive-review-assessing-latest-changes.prompt.md`
- `.github/prompts/implement.prompt.md`
