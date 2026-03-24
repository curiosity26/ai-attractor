# Attractor Pipeline Seed Template

A generalized template for building rigorous, self-correcting attractor pipelines with multi-model consensus.

## Architecture

Every sprint follows the same loop:

```
DO work → VALIDATE + CRITIQUE (parallel) → MERGE consensus → GATE
  ↓ pass: next sprint
  ↓ fail: repeat DO with failure context
```

After all sprints:

```
FINAL VALIDATE + CRITIQUE (parallel) → MERGE → GATE
  ↓ pass: exit
  ↓ fail: restart from orient with failure context
```

### Node Roles

| Role | Shape | Purpose |
|------|-------|---------|
| **DO** | box (codergen) | Perform the work. Receives failure context from previous attempts. |
| **VALIDATE** | box (codergen) | Verify the work by exercising the system under test. Save evidence (screenshots, logs, artifacts) to a shared directory. Output `CONTEXT_SET: sprint_pass=true/false`. |
| **CRITIQUE** | box (codergen) | Independent review of the evidence. Multiple models review the same artifacts. No direct access to the system under test needed — pure analysis of saved evidence. |
| **FAN-OUT** | component (parallel) | Launches validate + all critique nodes concurrently. |
| **MERGE** | tripleoctagon (fan_in) | Consensus judge. Reads validation results and all critiques. Fixes real issues, dismisses false alarms. Outputs `CONTEXT_SET: sprint_pass=true/false` and `failure_context`. |
| **GATE** | diamond (conditional) | Routes on `context.sprint_pass=true` (next sprint) or `!=true` (repeat DO). |

### Key Principles

**1. Observe, don't infer.**
Validate by exercising the actual system — not by reading source code or running unit tests alone. If the deliverable is a UI, interact with it. If it's an API, call it. If it's a document, read it. Primary evidence comes from the system itself.

**2. Evidence is shared, not reproduced.**
The validate node captures evidence (screenshots, output logs, API responses) and saves it to a known directory. Critique nodes review that same evidence. This ensures all reviewers assess identical artifacts, regardless of their tool access.

**3. Multiple independent perspectives.**
At least three models critique independently. They have different strengths — one may catch visual issues another misses, one may notice logical gaps. The merge node resolves disagreements.

**4. Failure context accumulates.**
When a sprint fails, the merge node describes what's wrong. The DO node's prompt includes `$context.failure_context` so the next iteration targets the specific issues. Each retry is more informed than the last.

**5. Positive signals, not just absence of errors.**
"No errors found" is not sufficient. The validate node must observe the feature actually working — a tooltip appearing, a completion dropdown showing correct items, an output matching expected format. Define what a positive signal looks like for each behavior.

**6. Exhaustive permutations from the spec.**
If a specification defines N variants of a construct, test all N — not a sample. The spec is the test matrix. Every production rule, every operator, every edge case.

**7. The system under test decides, not the pipeline.**
When behavior depends on external data (server responses, dynamic content), ask the system what's available rather than hardcoding expectations. The pipeline adapts to the environment.

## Template Structure

```dot
digraph pipeline {
    graph [
        goal="<What this pipeline validates. Include:
          - Paths to specs, implementation, reference code
          - Tool access instructions (MCP, CLI, API endpoints)
          - Authentication/login instructions if needed
          - Evidence directory path
          - CONTEXT_SET directive format>",
        label="<Pipeline Name>",
        default_max_retries=2,
        retry_target="orient",
        model_stylesheet="
            * { llm_model: claude-sonnet-4-6; llm_provider: anthropic; }
            .critical { llm_model: claude-opus-4-6; llm_provider: anthropic; }
            .claude_critique { llm_model: claude-opus-4-6; llm_provider: anthropic; }
            .codex_critique { llm_model: gpt-5.2; llm_provider: openai; }
            .gemini_critique { llm_model: gemini-3.1-pro-preview-customtools; llm_provider: google; }
        "
    ]

    start [shape=Mdiamond]
    exit  [shape=Msquare]

    // ─── ORIENT ───
    // Read project state, verify prerequisites, prepare environment.
    orient [class="quick", prompt="<Read context. Verify prerequisites.
        Previous failure context: $context.failure_context>"]

    // ─── SPRINT N: <Name> ───

    // DO: Perform the work. Fix issues from previous failure context.
    do_N [class="critical", prompt="<Sprint description.
        Previous failure context: $context.failure_context
        1. Read the relevant spec
        2. Do the work
        3. Verify via the system under test
        4. Save evidence to <evidence_dir>
        5. Run automated checks (tests, lint, type check)>"]

    // VALIDATE + CRITIQUE (parallel fan-out)
    vc_N_fan [shape=component]

    // VALIDATE: Exercise the system, save evidence
    validate_N [class="critical", prompt="<Verify by exercising the system.
        Save evidence to <evidence_dir> with descriptive names.
        Output: CONTEXT_SET: sprint_pass=true/false
        Output: CONTEXT_SET: failure_context=<what failed>>"]

    // CRITIQUE: Review the saved evidence (no system access needed)
    critique_N_claude [class="claude_critique", prompt="<Review evidence at <evidence_dir>. Report EVERY issue.>"]
    critique_N_codex  [class="codex_critique",  prompt="<Review evidence at <evidence_dir>. Report EVERY issue.>"]
    critique_N_gemini [class="gemini_critique",  prompt="<Review evidence at <evidence_dir>. Report EVERY issue.>"]

    // MERGE: Consensus judge
    merge_N [shape=tripleoctagon, class="critical", prompt="<Read validation + 3 critiques.
        Fix real issues. Dismiss false alarms.
        Output: CONTEXT_SET: sprint_pass=true/false
        Output: CONTEXT_SET: failure_context=<what still fails>>"]

    // GATE: Route pass/fail
    gate_N [shape=diamond]

    // EDGES for Sprint N:
    do_N -> vc_N_fan [condition="outcome=success"]
    vc_N_fan -> validate_N
    vc_N_fan -> critique_N_claude
    vc_N_fan -> critique_N_codex
    vc_N_fan -> critique_N_gemini
    validate_N -> merge_N
    critique_N_claude -> merge_N
    critique_N_codex -> merge_N
    critique_N_gemini -> merge_N
    merge_N -> gate_N [condition="outcome=success"]
    gate_N -> do_NEXT [label="Pass", condition="context.sprint_pass=true"]
    gate_N -> do_N [label="Fail", condition="context.sprint_pass!=true"]

    // ─── FINAL ───
    // Same pattern but gate routes to exit (pass) or orient (fail)
    final_fan [shape=component]
    // ... validate + 3 critiques + merge ...
    gate_final [shape=diamond]
    gate_final -> exit [label="Pass", condition="context.sprint_pass=true"]
    gate_final -> orient [label="Fail", condition="context.sprint_pass!=true"]
}
```

## Writing Sprint Prompts

### DO Node Prompt Checklist
- [ ] References the relevant specification section
- [ ] Includes `Previous failure context: $context.failure_context`
- [ ] Describes the work to perform
- [ ] Instructs to verify via the actual system (not just tests)
- [ ] Instructs to save evidence to the shared directory
- [ ] Instructs to run automated checks after changes
- [ ] References implementation code and any reference implementations

### VALIDATE Node Prompt Checklist
- [ ] Clears previous evidence in the shared directory
- [ ] Exercises every behavior defined in the spec for this sprint
- [ ] Saves evidence with descriptive filenames
- [ ] Tests exhaustive permutations (all spec variants, not samples)
- [ ] Requires positive signals (feature works, not just no errors)
- [ ] Outputs `CONTEXT_SET: sprint_pass=true/false`
- [ ] Outputs `CONTEXT_SET: failure_context=<details>` on failure

### CRITIQUE Node Prompt Checklist
- [ ] Reads evidence from the shared directory (specific file patterns)
- [ ] Lists exactly what to look for in each piece of evidence
- [ ] Instructs to be harsh — report everything, no matter how minor
- [ ] Requires issue reports to reference the specific evidence file
- [ ] Does NOT require access to the system under test

### MERGE Node Prompt Checklist
- [ ] Reads validation results and all critique reports
- [ ] For each issue: determines real bug vs false alarm
- [ ] Fixes real bugs and re-verifies
- [ ] Outputs `CONTEXT_SET: sprint_pass=true/false`
- [ ] Outputs `CONTEXT_SET: failure_context=<what still fails>`

## Splitting Work into Sprints

Each sprint should be:
- **Isolated**: Completable and verifiable independently
- **Focused**: One behavioral domain (not a grab bag)
- **Ordered by dependency**: Later sprints may depend on earlier ones passing
- **Sized for one agent session**: Not so large that context is exhausted

Common sprint patterns:
1. **Foundation** — Core functionality that everything else depends on
2. **Intelligence** — Dynamic features (completions, suggestions, inference)
3. **Presentation** — Visual rendering, formatting, styling
4. **Integration** — How the component interacts with its environment
5. **Polish** — Edge cases, accessibility, error handling

## Evidence Types

| System Type | Evidence Format | How to Capture |
|-------------|----------------|----------------|
| Web UI | Screenshots (.png) | Playwright `browser_take_screenshot()` |
| API | Response JSON | `curl` or programmatic calls saved to files |
| CLI tool | Terminal output | Command output redirected to files |
| Document | The document itself | File path reference |
| Data pipeline | Output datasets | Saved to evidence directory |

## Prerequisites

The attractor engine must support:
- `CONTEXT_SET: key=value` parsing from LLM output (codergen handler)
- `$context.key` expansion in prompts (codergen handler)
- `component` shape for parallel fan-out
- `tripleoctagon` shape for fan-in with optional LLM consolidation
- `diamond` shape for conditional routing on context variables
