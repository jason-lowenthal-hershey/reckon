Run a SOLID + Clean Code audit on the repository before allowing a commit or push.

## Steps

1. **Automated checks first** — run `npm run lint` and `npm test`. Report results. If either fails, stop immediately and do not proceed to the manual review: the code is not ready.

2. **Determine scope** — if `$ARGUMENTS` specifies a path or file, audit only that. Otherwise audit every file that is staged or modified according to `git status` and `git diff --name-only HEAD`. If there are no changed files, audit the whole codebase.

3. **SOLID review** — for each file in scope, read its full content and check:

   - **S — Single Responsibility**: does every function/module do exactly one thing? Flag any function longer than ~30 lines or that performs multiple unrelated operations.
   - **O — Open/Closed**: are behaviours extended through new code rather than by editing existing logic? Flag `switch`/`if-else` chains that would need editing to add a new case when a data-driven or polymorphic approach exists.
   - **L — Liskov Substitution**: where functions accept objects, do callers need to know the concrete type? Flag duck-typing violations or `instanceof` checks used for branching.
   - **I — Interface Segregation**: are functions passed more context than they use? Flag parameters that are objects where only one property is consumed — prefer passing that property directly.
   - **D — Dependency Inversion**: do high-level modules depend directly on low-level details? Flag hard-coded `require()` calls inside business logic that make unit testing impossible without monkey-patching. (`lib/generator.js` is pure and fine; `api/` calling `require('../lib/generator')` at module load is acceptable given the Vercel serverless constraint.)

4. **Clean Code review** — for each file in scope, check:

   - **Names**: are variables, functions, and parameters named to reveal intent? Flag single-letter names (except loop indices `i`, `j`), generic names (`data`, `result`, `temp`, `obj`), and boolean names that don't read as predicates (`isValid`, `hasResult` are good; `flag`, `check` are not).
   - **Functions**: flag functions that do more than one thing, have more than 3 parameters, or return different types depending on control flow.
   - **DRY**: flag logic copied across two or more places that could be extracted.
   - **Dead code**: flag unreachable branches, commented-out code, and variables that are assigned but never read.
   - **Comments**: flag comments that restate what the code does rather than explaining *why*. Flag `TODO`/`FIXME` items that have no associated issue reference.
   - **Error handling**: flag empty `catch {}` blocks with no explanation, and errors that are swallowed without logging or re-throwing.

5. **Puzzle-privacy rule check** — scan any changed `api/` or `scripts/` file for `console.log` / `console.error` calls. If any of them log `start`, `target`, `pool`, or `solution`, flag it as a **critical violation** (SPEC.md §4.7).

6. **Report** — produce a structured report:

   ```
   ── Automated ──────────────────────────────
   Lint:  ✅ / ❌  (N errors)
   Tests: ✅ / ❌  (N failed)

   ── SOLID ──────────────────────────────────
   [file:line] [Principle] Description of violation

   ── Clean Code ─────────────────────────────
   [file:line] [Rule] Description of violation

   ── Puzzle Privacy ─────────────────────────
   [file:line] CRITICAL: ...

   ── Verdict ────────────────────────────────
   ✅ PASS — ready to commit/push
     OR
   ❌ BLOCK — fix the above before committing
   ```

   Block (verdict = BLOCK) if: lint fails, tests fail, any critical puzzle-privacy violation exists, or there are more than 3 SOLID/Clean Code findings. For 1–3 minor findings, verdict is PASS with a warning listing the suggestions for the author to decide on.

7. **Address all findings immediately** — do not stop after reporting. For every finding listed (BLOCK or PASS-with-warnings), apply the fix in-line right now:

   - **Names** (`lbl`, `tmp`, etc.) — rename with a search-and-replace Edit. Update every reference in the file.
   - **DRY** (duplicated helpers) — extract to a shared module (e.g. `lib/utils.js`), require it from both call sites, delete the local copies, and add tests for the new module in `tests/`.
   - **S — oversized function** — extract the distinct concern(s) into a new named function placed immediately before the original. Rewrite the original to call the extracted function(s). Keep the extracted function in the same file unless it is reused across files.
   - **I — unused parameter** — remove the extra argument from the call site (or add it to the function signature if it was always intended to be used).
   - **Comments** — rewrite misleading or restating comments in place.
   - **O / D / L** — propose and apply the smallest refactor that removes the flag (e.g. a lookup table replacing a switch, or injecting a dependency via a parameter).
   - **Puzzle privacy** — remove the offending log line immediately; this is a CRITICAL fix.

   After applying all fixes, re-run `npm run lint` and `npm test`. If either fails, fix the regression before continuing.

8. If the verdict was PASS (including after fixing warnings), confirm: "All findings addressed. Audit passed. You may now commit and push."
   If the verdict was BLOCK, confirm after fixing: "All findings addressed and verified. You may now commit and push."
   Do not offer to commit or push until lint and tests are green post-fix.
