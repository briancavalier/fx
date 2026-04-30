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

Development guidance:
- Prefer existing patterns in `src/Fx.ts`, `src/Effect.ts`, and `src/Handler.ts`.
- Preserve strong effect typing. Changes should keep `E` unions meaningful and narrowed by handlers.
- Add focused tests under `src/*.test.ts` for behavior and type-level expectations where relevant.
- Do not edit `dist/` directly; build output is generated.
- Keep examples practical and small.
