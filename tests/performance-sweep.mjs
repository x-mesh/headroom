import assert from 'node:assert/strict';
import { calculateSurvivalMultiplier, sweepFailureDomains, sweepSingleFaults } from '../public/engine.js';

function performanceFixture() {
  const devices = Array.from({ length: 200 }, (_, index) => ({
    id: `n${index}`, kind: 'switch', limits: { forwarding_bps: 1e12, forwarding_pps: 1e10 },
  }));
  const links = [];
  for (let index = 0; index < 200; index += 1) for (const step of [1, 2]) {
    links.push({ id: `l${links.length}`, source: `n${index}`, target: `n${(index + step) % 200}`, capacity: { forwarding_bps: 1e12 } });
  }
  for (let index = 0; index < 100; index += 1) {
    links.push({ id: `l${links.length}`, source: `n${index}`, target: `n${index + 100}`, capacity: { forwarding_bps: 1e12 } });
  }
  const demands = Array.from({ length: 1000 }, (_, index) => ({
    id: `d${index}`, source: 'n0', target: 'n100', load: { forwarding_bps: 1e6, forwarding_pps: 1000 },
  }));
  const failureDomains = Array.from({ length: 8 }, (_, index) => ({
    id: `domain-${index + 1}`, name: `DOMAIN ${index + 1}`, kind: 'power', deviceIds: [`n${20 + index * 20}`], linkIds: [],
  }));
  return { devices, links, demands, failureDomains };
}

function measure(action) {
  const started = performance.now();
  const value = action();
  return { value, elapsedMs: Math.round((performance.now() - started) * 100) / 100 };
}

const topology = performanceFixture();
const single = measure(() => sweepSingleFaults(topology));
const survival = measure(() => calculateSurvivalMultiplier(topology, { sweep: single.value }));
const domains = measure(() => sweepFailureDomains(topology));

assert.equal(single.value.resources.length, 700);
assert.equal(domains.value.domainCount, 8);
assert.equal(domains.value.pairs.length, 28);
assert.equal(survival.value.candidates, 698);

console.log(JSON.stringify({
  runtime: process.version,
  fixture: { devices: 200, links: 500, demands: 1000, singleFaultCandidates: single.value.resources.length, domains: domains.value.domainCount, domainPairs: domains.value.pairs.length },
  timingsMs: { singleFaultSweep: single.elapsedMs, survivalMultiplier: survival.elapsedMs, domainSweep: domains.elapsedMs, total: Math.round((single.elapsedMs + survival.elapsedMs + domains.elapsedMs) * 100) / 100 },
  results: { singleFaults: single.value.resources.length, survivalCandidates: survival.value.candidates, domainCandidates: domains.value.evaluated },
}, null, 2));
