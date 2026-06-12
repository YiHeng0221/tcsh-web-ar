# REVIEWS — Audit log

> Append-only log of AI code reviews on this repo. One `RR-NNN` block per
> PR. Same-PR re-reviews append a `### Round N` sub-heading instead of
> opening a new RR. **Empty reviews (0🔴 0🟡 0🟣) still get an entry** —
> that's the audit evidence for "no problems found".

Convention summary:

- Numbering: `RR-001`, `RR-002`, ... (3-digit zero-pad).
- New RR for new PR. New round = sub-heading under the same RR.
- Reviewer field: `local Claude Code` for `/review`, `CI (claude CLI)` for
  the `ai-review.sh` automated path, `cross-agent` for `/review --cross`.
- Model field: the model id Claude reports (e.g. `sonnet`, `opus`,
  `claude-opus-4-7`).
- Findings counts come from the report's table — copy them, don't
  re-grade.

Template:

```markdown
## RR-NNN — <PR title>
- PR: #<N>
- Date: <YYYY-MM-DD>
- Reviewer: local Claude Code | CI (claude CLI) | cross-agent
- Model: <model id>
- Verdict: pass | changes-requested
- Findings: 🔴×N · 🟡×N · 🟣×N
- Round: 1 of 3

### Key concerns
- <one line per concern, with file:line>
```

Round 2+ sub-heading (append under the matching RR):

```markdown
### Round 2 (YYYY-MM-DD)
- Verdict: …
- Findings: …
- What changed since round 1: <one line>
```

---

<!-- New RR entries go below this line. -->
