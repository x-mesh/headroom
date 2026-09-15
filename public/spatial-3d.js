import * as THREE from './vendor/three.module.js';

const PROFILES = Object.freeze({
  switch: [3.6, .72, 2.1, 0x2f675c], hub: [3.2, .78, 2.0, 0x386b61], router: [3.2, 1.0, 2.25, 0x315e56], modem: [2.7, .9, 1.9, 0x41675f], wireless: [2.8, .45, 2.5, 0x477b70],
  firewall: [3.1, 1.25, 2.0, 0x626b55], ips: [3.1, 1.15, 2.0, 0x526654], waf: [3.1, 1.15, 2.0, 0x536a5b], vpn: [3.0, 1.0, 2.0, 0x4c6258], sslvpn: [3.0, 1.0, 2.0, 0x4c6258], lb: [3.2, .9, 2.1, 0x2d6459],
  server: [2.65, 2.1, 2.35, 0x435f59], web: [2.65, 1.8, 2.2, 0x42645d], vm: [2.45, 1.45, 2.0, 0x496961], db: [2.9, 2.45, 2.3, 0x455e5d], mail: [2.65, 1.8, 2.2, 0x4c645e], mainframe: [3.25, 3.3, 2.6, 0x394f50],
  storage: [3.2, 2.8, 2.45, 0x436360], nas: [3.0, 2.5, 2.25, 0x4b6965], backup: [3.0, 2.55, 2.3, 0x526a64], cloud: [3.35, 1.0, 3.0, 0x3e7771], client: [2.5, .65, 1.75, 0x4c625b],
});
const STATUS = Object.freeze({ healthy: 0x077165, warning: 0x8b5100, overloaded: 0xb83c34, unknown: 0x697286, invalid: 0xb83c34, disabled: 0x697286 });

function makeLabel(text, status) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
  const context = canvas.getContext('2d'); context.fillStyle = 'rgba(247,250,247,.94)'; context.fillRect(0, 0, 512, 128);
  context.fillStyle = '#13241f'; context.font = '600 42px Pretendard, sans-serif'; context.textAlign = 'center'; context.fillText(text, 256, 57);
  context.fillStyle = status; context.fillRect(0, 112, 512, 16);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.scale.set(5.6, 1.4, 1); return sprite;
}

function makeDevice(device) {
  const [width, height, depth, color] = PROFILES[device.kind] || [2.8, 1.1, 2.0, 0x47645d];
  const status = device.active ? device.primaryStatus : 'disabled'; const group = new THREE.Group(); group.userData = { deviceId: device.id, pickable: true };
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), new THREE.MeshStandardMaterial({ color: device.active ? color : 0x59635f, roughness: .38, metalness: .35 }));
  chassis.position.y = height / 2; chassis.castShadow = true; chassis.receiveShadow = true; chassis.userData = group.userData; group.add(chassis);
  const railMaterial = new THREE.MeshStandardMaterial({ color: STATUS[status], emissive: STATUS[status], emissiveIntensity: device.active ? .55 : 0 });
  const rail = new THREE.Mesh(new THREE.BoxGeometry(width * .82, .08, .08), railMaterial); rail.position.set(0, height * .52, depth / 2 + .05); group.add(rail);
  const ports = Math.min(12, device.kind === 'switch' ? 12 : device.kind === 'router' ? 6 : 4);
  for (let index = 0; index < ports; index += 1) {
    const port = new THREE.Mesh(new THREE.BoxGeometry(.16, .12, .05), new THREE.MeshStandardMaterial({ color: 0x0e2420, emissive: index % 3 === 0 && device.active ? STATUS[status] : 0x000000, emissiveIntensity: .5 }));
    port.position.set((index - (ports - 1) / 2) * Math.min(.31, width * .72 / ports), height * .38, depth / 2 + .04); group.add(port);
  }
  if (['server', 'web', 'vm', 'db', 'mail', 'mainframe', 'storage', 'nas', 'backup'].includes(device.kind)) {
    for (let row = 0; row < 2; row += 1) for (let column = 0; column < 2; column += 1) {
      const bay = new THREE.Mesh(new THREE.BoxGeometry(.48, .22, .06), new THREE.MeshStandardMaterial({ color: 0x152b27, metalness: .55, roughness: .3 }));
      bay.position.set(-width * .22 + column * .58, height * (.32 + row * .24), depth / 2 + .045); group.add(bay);
    }
  }
  if (device.kind === 'wireless') for (const side of [-1, 1]) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.35, 8), railMaterial); antenna.position.set(side * width * .28, height + .5, 0); antenna.rotation.z = side * -.22; group.add(antenna);
  }
  const label = makeLabel(device.name, '#' + STATUS[status].toString(16).padStart(6, '0')); label.position.set(0, height + 1.15, 0); label.userData = group.userData; group.add(label);
  return group;
}

function makeLink(from, to, status, active) {
  const curve = new THREE.LineCurve3(from.clone().setY(.32), to.clone().setY(.32));
  const material = new THREE.MeshStandardMaterial({ color: STATUS[status] || 0x5b8076, emissive: STATUS[status] || 0x1e4f47, emissiveIntensity: active ? .3 : 0, roughness: .45 });
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, .055, 8, false), material); mesh.receiveShadow = true; return { mesh, curve };
}

export function createSpatialScene({ host, canvas, labels, onSelect, onViewChange, initialView, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdceae2); scene.fog = new THREE.Fog(0xdceae2, 65, 115);
  const camera = new THREE.PerspectiveCamera(44, 1, .1, 200); const world = new THREE.Group(); scene.add(world);
  scene.add(new THREE.HemisphereLight(0xf4fbf7, 0x16332d, 2.1));
  const key = new THREE.DirectionalLight(0xffffff, 3.6); key.position.set(-20, 35, 24); key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -35; key.shadow.camera.right = 35; key.shadow.camera.top = 28; key.shadow.camera.bottom = -28; scene.add(key);
  const rim = new THREE.DirectionalLight(0xb8e737, 1.2); rim.position.set(28, 15, -25); scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), new THREE.MeshStandardMaterial({ color: 0xc9ddd3, roughness: .82 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  const grid = new THREE.GridHelper(90, 45, 0x9eb9ad, 0xbfd1c8); grid.position.y = .012; grid.material.transparent = true; grid.material.opacity = .48; world.add(grid);
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pickables = []; let packets = [];
  const defaults = { yaw: -28, pitch: 38, distance: 31 };
  const view = { yaw: THREE.MathUtils.degToRad(initialView?.yaw ?? defaults.yaw), pitch: THREE.MathUtils.degToRad(initialView?.pitch ?? defaults.pitch), distance: initialView?.distance ?? defaults.distance, target: new THREE.Vector3() }; let dragging = null; let raf = 0; let active = false; let last = performance.now(); let reduce = reducedMotion;
  function placeCamera() { const cp = Math.cos(view.pitch); camera.position.set(Math.sin(view.yaw) * cp * view.distance, Math.sin(view.pitch) * view.distance, Math.cos(view.yaw) * cp * view.distance); camera.lookAt(view.target); }
  function resize() { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  function renderFrame(now) { if (!active) return; const delta = Math.min(.05, (now - last) / 1000); last = now; for (const packet of packets) { if (!reduce) packet.t = (packet.t + delta * packet.speed) % 1; packet.dot.position.copy(packet.curve.getPointAt(packet.t)); packet.dot.position.y += .26; } placeCamera(); renderer.render(scene, camera); raf = requestAnimationFrame(renderFrame); }
  function disposeObject(object) {
    object.traverse((child) => {
      child.geometry?.dispose();
      const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : [];
      for (const material of materials) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); }
    });
  }
  function clearWorld() { for (const child of [...world.children].slice(2)) { world.remove(child); disposeObject(child); } pickables = []; packets = []; }
  function update({ devices, links, selectedId }) {
    clearWorld(); if (!devices.length) return; const positions = new Map(); const xs = devices.map((item) => item.position.x); const ys = devices.map((item) => item.position.y); const centerX = (Math.min(...xs) + Math.max(...xs)) / 2; const centerY = (Math.min(...ys) + Math.max(...ys)) / 2;
    for (const device of devices) { const mesh = makeDevice(device); mesh.position.set((device.position.x - centerX) / 28, device.id === selectedId ? .7 : 0, (device.position.y - centerY) / 28); positions.set(device.id, mesh.position.clone()); world.add(mesh); pickables.push(...mesh.children.filter((child) => child.isMesh || child.isSprite)); }
    for (const link of links) { const from = positions.get(link.source); const to = positions.get(link.target); if (!from || !to) continue; const status = link.severed ? 'disabled' : link.primaryStatus || 'healthy'; const result = makeLink(from, to, status, !link.severed); world.add(result.mesh); if (!link.severed && (link.axes?.forwarding_bps?.utilization ?? 0) > 0) { const dot = new THREE.Mesh(new THREE.SphereGeometry(.13, 12, 8), new THREE.MeshStandardMaterial({ color: STATUS[status], emissive: STATUS[status], emissiveIntensity: 1.2 })); world.add(dot); packets.push({ dot, curve: result.curve, t: Math.random(), speed: .08 + Math.min(link.axes.forwarding_bps.utilization, 1) * .16 }); } }
    labels.textContent = devices.length + ' DEVICES · ' + links.length + ' LINKS · WEBGL';
  }
  function reportView() { onViewChange?.({ yaw: THREE.MathUtils.radToDeg(view.yaw), pitch: THREE.MathUtils.radToDeg(view.pitch), distance: view.distance }); }
  function orbit(dx, dy, report = true) { view.yaw += dx * .007; view.pitch = THREE.MathUtils.clamp(view.pitch + dy * .006, .22, 1.36); if (report) reportView(); }
  function reset() { view.yaw = THREE.MathUtils.degToRad(defaults.yaw); view.pitch = THREE.MathUtils.degToRad(defaults.pitch); view.distance = defaults.distance; reportView(); }
  function zoom(factor) { view.distance = THREE.MathUtils.clamp(view.distance * factor, 18, 90); reportView(); }
  function pick(event) { const box = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1; pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(pickables, false).find((entry) => entry.object.userData.deviceId); if (hit) onSelect(hit.object.userData.deviceId); }
  canvas.addEventListener('pointerdown', (event) => { dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!dragging || dragging.id !== event.pointerId) return; const dx = event.clientX - dragging.x; const dy = event.clientY - dragging.y; dragging.moved ||= Math.hypot(dx, dy) > 3; orbit(-dx, -dy, false); dragging.x = event.clientX; dragging.y = event.clientY; });
  canvas.addEventListener('pointerup', (event) => { if (!dragging || dragging.id !== event.pointerId) return; if (!dragging.moved) pick(event); else reportView(); dragging = null; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); zoom(Math.exp(event.deltaY * .001)); }, { passive: false });
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return { start() { if (active) return; active = true; last = performance.now(); resize(); raf = requestAnimationFrame(renderFrame); }, stop() { active = false; cancelAnimationFrame(raf); }, update, orbit, reset, zoom, setReducedMotion(value) { reduce = Boolean(value); }, dispose() { observer.disconnect(); clearWorld(); renderer.dispose(); }, debug() { return { renderer: 'WebGLRenderer', meshes: pickables.length, packets: packets.length, camera: camera.position.toArray(), canvas: [canvas.width, canvas.height], reducedMotion: reduce, view: { yaw: THREE.MathUtils.radToDeg(view.yaw), pitch: THREE.MathUtils.radToDeg(view.pitch), distance: view.distance } }; } };
}
