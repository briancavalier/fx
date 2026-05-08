# Agent Notes

`fx` is a small TypeScript algebraic effects and handlers library.

Core idea:
- Programs are `Fx<E, A>` generator computations.
- Effects are yielded with `yield*`.
- Handlers progressively eliminate effects via `handle`/`control`.
- Keep the core minimal; avoid adding framework-like dependency graphs, schedulers, or service containers.

Primary commands:
- `npm test`
- `npm run typecheck`
- `npm run build`
- `npm run lint`

Design preference:
- Prefer simple, direct, explicit implementations over clever or implicit ones.
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
- Organize source modules from higher-level public constructs to lower-level implementation details: effect declarations first, public constructors/handlers next, exported support types after that, and internal helpers last.
- Document public effect declarations succinctly. Effect docs should describe the request represented by the effect, not the behavior of any particular handler.
- Keep handler behavior docs on the handler that provides that behavior.
- Add focused tests under `src/*.test.ts` for behavior and type-level expectations where relevant.
- Do not edit `dist/` directly; build output is generated.
- Keep examples practical and small.
