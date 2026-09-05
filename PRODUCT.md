# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: static HTML, CSS, and JavaScript with no runtime dependencies. Use Node.js built-in test tooling for the calculation engine.

## Users

The primary users are infrastructure engineers, network engineers, SREs, and data center designers. They review rack designs, capacity changes, and failure scenarios.

Learners are a secondary audience. They use presets to understand why a design reaches a non-bandwidth limit first.

## Product Purpose

Rack Mesh places physical infrastructure on a topology and applies traffic to it. It identifies the device and capacity axis that reaches its limit first. It recalculates overloads and disconnected demand after a device or link failure. It also turns each resource off in turn, so a design states whether one loss severs the service, overloads the survivors, or is absorbed.

## Positioning

Rack Mesh treats each device as a set of independent limits. It reports bps, pps, CPS, concurrent sessions, power, and rack space separately instead of reducing capacity to one score.

## Operating Context

Users start from a topology preset or an imported project. They adjust workload scale, inspect each device axis, disable infrastructure, compare the result with the baseline, and export the scenario for a design review.

## Capabilities and Constraints

- Phase 1 covers one data center and steady-state constraints.
- The browser performs all calculations without a server.
- The engine uses deterministic path allocation.
- Missing or incompatible capacity data remains `unknown`.
- Phase 1 does not simulate packets, control-plane convergence, queues, server compute, or storage performance.
- The product name is Rack Mesh. Repositories, packages, and CLI identifiers use `rack-mesh`.
- The calculation term `headroom` remains lowercase.

## Evidence on Hand

The product requirements are in `infra-simulator-prd.md`. No customer evidence, production device library, logo, or approved visual identity exists yet. Demonstration values must be labeled as synthetic.

## Product Principles

- Show the binding axis, not one combined health score.
- Keep unknown data visible. Never convert it to a safe state.
- Preserve the calculation source, assumptions, and selected limit.
- Make failure effects comparable with the baseline.
- Keep the same input deterministic across runs.

## Accessibility & Inclusion

Do not encode status with color alone. Support keyboard focus for all controls and device inspection.
