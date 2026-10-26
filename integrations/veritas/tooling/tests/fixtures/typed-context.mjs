// Synthetic metadata only. Independent existing fixture encoders seal the graph.
import { makeBn01Fixture, fixtureBytes } from '../../neural/bn01-fixture.mjs';
import { makeDualFixture, canonicalFixtureBytes } from '../../neural/dual-face-fixture.mjs';
export function typedContext() {
  const base = makeBn01Fixture(), dual = makeDualFixture(base);
  return { base, dual, baseBytes: fixtureBytes(base), dualBytes: canonicalFixtureBytes(dual),
    pins: { graphSha256: base.graph.sha256, runSha256: base.run.sha256,
      topologySha256: dual.topology.sha256, planSha256: dual.plan.sha256 } };
}
