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
- Never force push to a remote PR branch or PR worktree unless specifically told to do so. Always maintain full history on PR branches and PR worktrees.
