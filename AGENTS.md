# Agent Notes

`fx` is a small TypeScript algebraic effects and handlers library.

Core idea:
- Programs are `Fx<E, A>` generator computations.
- Effects are yielded with `yield*`.
- Handlers progressively eliminate effects via `handle`/`control`.
- Keep the core minimal; avoid adding framework-like dependency graphs, schedulers, or service containers.

Primary commands:
- `pnpm test`
- `pnpm typecheck`
- `pnpm build`
- `pnpm lint`

Git worktrees:
- Use git worktrees by default for agent work.
- Work in the current checkout only when the user explicitly directs it or when the task is limited to read-only inspection, planning, or answering questions.
- Treat worktrees as PR-ready branches, not scratch space.
- Create new worktrees with `pnpm worktree:create -- <short-task> [base-ref]`.
- Do not create worktrees with raw `git worktree add` unless the script cannot support an explicitly requested case; if bypassing the script, follow the same branch, path, status file, and workspace file conventions.
- Create worktrees under `/private/tmp/fx-worktrees/<short-task>`.
- Use branch names like `codex/<short-task>`.
- Base new worktrees from latest `origin/main` unless the user explicitly specifies another ref.
- Keep each worktree scoped to one coherent PR-sized change.
- Keep file ownership disjoint across parallel worktrees whenever possible.
- Maintain an ignored `AGENT_STATUS.md` in each worktree for human inspection; its generated format comes from `templates/AGENT_STATUS.md`.
- Update `AGENT_STATUS.md` when starting work, after significant code or test changes, after validation runs, and before handing work back to the user.
- Keep `AGENT_STATUS.md` accurate: record scope, current status, validation results, blockers, and notes a human would need to inspect or resume the worktree.
- Create an ignored `.code-workspace` file in each worktree so it is easy to reopen in VS Code.
- `pnpm worktree:create` installs dependencies in the new worktree with `pnpm install --frozen-lockfile`; if install fails, run it manually from the worktree before trusting editor diagnostics.
- After dependency installation, stale VS Code TypeScript diagnostics may require restarting TS Server or reopening the generated workspace.
- Run validation from the worktree that owns the change.
- Treat `pnpm typecheck` as the project typecheck; direct single-file `tsc` commands can bypass `tsconfig.json` and report misleading errors.
- Commit finished work inside the worktree with a focused commit message.
- Push the branch and open a draft PR when the user asks to publish.
- Do not remove PR-ready worktrees unless the branch has been merged, abandoned by explicit user instruction, or the user asks for cleanup.
- Before creating or updating a worktree, check the main workspace status and preserve unrelated dirty changes.

Design preference:
- Prefer simple, direct, explicit implementations over clever or implicit ones.
- Prefer eta reduction when it is semantically safe: pass an existing function directly instead of adding a lambda that only forwards the same arguments. Keep the wrapper when it changes arity, argument order, `this` binding, laziness/evaluation timing, error boundaries, overload/generic inference, variadic/spread behavior, or readability.
- Keep context propagation explicit at interpreter/runtime boundaries.
- Do not hide cross-cutting behavior in base abstractions unless it is fundamental to that abstraction.
- Avoid broad generic infrastructure until at least two concrete uses justify it.
- Prefer small internal helpers over framework-like dependency graphs, service containers, or ambient capability systems.
- Preserve construction-time vs execution-time behavior clearly; tests should make that boundary explicit.
- Start new features from the smallest public API that solves the use case.
- Keep internal state local to the module/runtime path that owns it.
- Prefer readable duplication over premature abstraction.
- If an implementation requires non-obvious tagging, ambient stacks, or implicit propagation, document why and add focused tests around the boundary.

Development guidance:
- Prefer existing patterns in `src/Fx.ts`, `src/Effect.ts`, and `src/Handler.ts`.
- Preserve strong effect typing. Changes should keep `E` unions meaningful and narrowed by handlers.
- Use `Fail<E>` for recoverable errors. In fx code, JS `throw` is reserved for intentionally hard-crashing the program, enforcing internal invariants, or clearly named unsafe/assert APIs such as `Fail.assert`.
- At runtime and platform boundaries, convert rejected promises, thrown platform errors, and recoverable exceptional states into `Fail` with `tryPromise`, `trySync`, or `fail`. Recover with `catchAll`, `catchOnly`, or `catchIf` rather than throwing from handlers.
- Organize source modules from higher-level public constructs to lower-level implementation details: effect declarations first, public constructors/handlers next, exported support types after that, and internal helpers last.
- Document public effect declarations succinctly. Effect docs should describe the request represented by the effect, not the behavior of any particular handler.
- Keep handler behavior docs on the handler that provides that behavior.
- Add focused tests under `src/*.test.ts` for behavior and type-level expectations where relevant.
- Do not edit `dist/` directly; build output is generated.
- Keep examples practical and small.
