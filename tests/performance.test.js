import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateScenario } from '../src/engine.js';

function performanceFixture() {
  const devices = Array.from({ length: 200 }, (_, i) => ({ id: `n${i}`, kind: 'switch', limits: { forwarding_bps: 1e12, forwarding_pps: 1e10 } }));
  const links = [];
  for (let i = 0; i < 200; i += 1) for (const step of [1, 2]) links.push({ id: `l${links.length}`, source: `n${i}`, target: `n${(i + step) % 200}`, capacity: { forwarding_bps: 1e12 } });
  for (let i = 0; i < 100; i += 1) links.push({ id: `l${links.length}`, source: `n${i}`, target: `n${i + 100}`, capacity: { forwarding_bps: 1e12 } });
  const demands = Array.from({ length: 1000 }, (_, i) => ({ id: `d${i}`, source: `n${i % 200}`, target: `n${(i * 17 + 31) % 200}`, load: { forwarding_bps: 1e6, forwarding_pps: 1000 } }));
  return { devices, links, demands };
}

test('200 devices / 500 links / 1000 demands retain deterministic results within the regression budget', (context) => {
  const topology = performanceFixture();
  const initial = calculateScenario(topology);
  for (let i = 0; i < 4; i += 1) calculateScenario(topology);
  const elapsed = [];
  for (let i = 0; i < 20; i += 1) {
    const start = performance.now();
    calculateScenario(topology);
    elapsed.push(performance.now() - start);
  }
  assert.deepEqual(calculateScenario(topology), initial);
  elapsed.sort((a, b) => a - b);
  const p95 = elapsed[Math.ceil(elapsed.length * 0.95) - 1];
  // CI 부하와 Node 런타임 편차를 허용하는 회귀 예산. PRD의 브라우저 100ms 목표와 별개다.
  const regressionBudgetMs = 300;
  context.diagnostic(JSON.stringify({ runtime: process.version, nodes: 200, links: 500, demands: 1000, samples: elapsed.length,
    warmP95Ms: Math.round(p95 * 100) / 100, prdTargetMs: 100, meetsPrdTarget: p95 <= 100, regressionBudgetMs }));
  assert.ok(p95 < regressionBudgetMs, `warm p95 ${p95.toFixed(1)}ms exceeds regression budget ${regressionBudgetMs}ms`);
});
