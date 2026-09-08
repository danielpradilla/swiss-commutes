# Display corrections

Deployed the flow-only map and restored the Geneva title. The renderer no longer paints road/rail traces or particle tails, calculates road widths, or allocates the shared-road volume indexes. Routed journeys, departure times, counts and mode filtering remain the same.

The previous and current CSS use the same font rules. The longer Geneva canton label triggered the existing mobile rule that shrinks city names to 48% of the heading size. Restoring Geneva restores its previous mobile size. No font-family change was made.

`verification.json` records the checks. All 164 remote files match the export, 36 tests pass, and lint/build pass. Live Geneva and Zürich retain their preceding audited counts at 07:45. Instrumenting the commuter overlay during a time change records zero line segments; moving dots and circles remain. The Geneva layout fits at 390 pixels. Desktop and mobile screenshots are included.

The [preceding data and deployment audit](../2026-09-06-deployed/README.md) preserves the numerical evidence and remaining limitations.
