import assert from 'node:assert/strict';
import test from 'node:test';
import { packetMotion, packetPixelSpeed, packetReach, sourceDriftAmplitude, sourceDriftFactor } from '../public/node-view.js';

test('source gates use documented amplitudes and keep measured values still', () => {
  assert.equal(sourceDriftAmplitude('estimate'), 0.04);
  assert.equal(sourceDriftAmplitude('datasheet'), 0.015);
  assert.equal(sourceDriftAmplitude('third_party_test'), 0.01);
  assert.equal(sourceDriftAmplitude('user_measured'), 0);
  assert.equal(sourceDriftAmplitude('user-correction'), 0);
  assert.equal(sourceDriftAmplitude('future-source'), 0.04);
  assert.equal(sourceDriftAmplitude(undefined), 0.04);
  assert.equal(sourceDriftFactor('axis', 10, 'user_measured'), 1);
  assert.equal(sourceDriftFactor('axis', 10, 'user-correction'), 1);
  assert.equal(sourceDriftFactor('axis', 10, 'estimate'), sourceDriftFactor('axis', 10, 'estimate'));
});

test('packet motion normalizes speed by utilization and clips overload reach', () => {
  assert.equal(packetPixelSpeed(0), 30);
  assert.equal(packetPixelSpeed(1), 115);
  assert.equal(packetPixelSpeed(1.22), 12);
  assert.ok(packetPixelSpeed(1) > packetPixelSpeed(0.5));
  assert.ok(packetPixelSpeed(1.22) < packetPixelSpeed(1));
  assert.equal(packetReach(1), 1);
  assert.equal(packetReach(1.22), 1 / 1.22);
  const forward = packetMotion(1.71, 300, 'forward');
  const reverse = packetMotion(1.71, 300, 'reverse');
  assert.equal(forward.keyPoints, `0;${1 / 1.71}`);
  assert.equal(reverse.keyPoints, `1;${1 - 1 / 1.71}`);
  assert.equal(forward.keyTimes, '0;1');
  assert.equal(reverse.calcMode, 'linear');
  assert.equal(packetMotion(1, 0), null);
  assert.equal(packetMotion(1, 600).duration / packetMotion(1, 300).duration, 2);
  assert.equal(300 / packetMotion(0.5, 300).duration, packetPixelSpeed(0.5));
});
