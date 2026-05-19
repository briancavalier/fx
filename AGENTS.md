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
- Prefer eta reduction when it is semantically safe: pass an existing function directly instead of adding a lambda that only forwards the same arguments. Keep the wrapper only when it changes arity, argument order, `this` binding, laziness/evaluation timing, error boundaries, overload/generic inference, variadic/spread behavior, or materially improves readability.
- Keep context propagation explicit at interpreter/runtime boundaries.
- Do not hide cross-cutting behavior in base abstractions unless it is fundamental to that abstraction.
- Avoid broad generic infrastructure until at least two concrete uses justify it.
- Prefer small internal helpers over framework-like dependency graphs, service containers, or ambient capability systems.
- Preserve construction-time vs execution-time behavior clearly; tests should make that boundary explicit.
- Start new features from the smallest public API that solves the use case.
- Keep internal state local to the module/runtime path that owns it.
- Prefer readable duplication over premature abstraction.
- If an implementation requires non-obvious tagging, ambient stacks, or implicit propagation, document why and add focused tests around the boundary.

Low-value wrappers:
- Do not introduce lambda, function, class, interface, or type-alias wrappers that only rename, forward, or restate an existing construct.
- Prefer exporting or passing the existing value/type directly when the wrapper does not add behavior, narrow a type, improve inference, enforce an invariant, adapt an API boundary, or clarify a real domain concept.
- Before adding a helper, ask what responsibility it owns. If the answer is only "avoid spelling this once" or "make the name nicer", keep the call site direct.
- Avoid one-use type aliases and interfaces unless they document a public contract, break a genuinely complex type into meaningful parts, or are needed for TypeScript inference/readability.
- Avoid wrapper functions around constructors, handlers, or combinators unless they change evaluation timing, argument order, error boundaries, type inference, or encode a named semantic operation.
- Prefer local readable duplication over extracting a generic helper from a single use.
- If a wrapper is kept for a non-obvious reason, leave a short comment or add a focused test that makes the reason visible.

Development guidance:
- Prefer existing patterns in `src/Fx.ts`, `src/Effect.ts`, and `src/Handler.ts`.
- Preserve strong effect typing. Changes should keep `E` unions meaningful and narrowed by handlers.
- Default global scope discipline:
  - `GlobalScope` is a real exported scope value, not an ambient capability.
  - Default-scope overloads are for concrete ergonomic use cases in small app-local code.
  - Prefer explicit named scopes in reusable functions, public APIs, libraries, nested control regions, and examples that teach composition.
  - Do not broaden default-scope overloads to every scoped effect by default; add focused runtime and type tests for each new default-scope API.
  - Keep default-scope requirements visible in types as `typeof GlobalScope` rather than hiding scope requirements behind ambient state.
  - Do not use `GlobalScope` as a catch-all for unrelated control effects; a global-scope handler may catch exits it did not intend to own.
- Use `Fail<E>` for recoverable errors. In fx code, JS `throw` is reserved for intentionally hard-crashing the program, enforcing internal invariants, or clearly named unsafe/assert APIs such as `Fail.assert`.
- At runtime and platform boundaries, convert rejected promises, thrown platform errors, and recoverable exceptional states into `Fail` with `tryPromise`, `trySync`, or `fail`. Recover with `catchAll`, `catchOnly`, or `catchIf` rather than throwing from handlers.
- Organize source modules from higher-level public constructs to lower-level implementation details: effect declarations first, public constructors/handlers next, exported support types after that, and internal helpers last.
- Document public effect declarations succinctly. Effect docs should describe the request represented by the effect, not the behavior of any particular handler.
- Keep handler behavior docs on the handler that provides that behavior.
- Add focused tests under `src/*.test.ts` for behavior and type-level expectations where relevant.
- Do not edit `dist/` directly; build output is generated.
- Keep examples practical and small.
- Never force push to a remote PR branch or PR worktree unless specifically told to do so. Always maintain full history on PR branches and PR worktrees.
