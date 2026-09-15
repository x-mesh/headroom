import * as THREE from './vendor/three.module.js';

const PROFILES = Object.freeze({
  switch: [3.8, .5, 2.2, 0x293632], hub: [3.4, .5, 2.0, 0x33423d], router: [3.6, .68, 2.35, 0x2b3935], modem: [3.1, .52, 2.0, 0x34443f], wireless: [3.4, .45, 2.1, 0x30423c],
  firewall: [3.6, .7, 2.35, 0x3b4139], ips: [3.6, .7, 2.35, 0x333e38], waf: [3.6, .7, 2.35, 0x34413b], vpn: [3.4, .52, 2.2, 0x303b37], sslvpn: [3.4, .52, 2.2, 0x303b37], lb: [3.6, .52, 2.25, 0x293b36],
  server: [3.55, .72, 2.65, 0x313c39], web: [3.55, .72, 2.55, 0x303d39], vm: [3.55, .52, 2.45, 0x34413d], db: [3.6, 1.05, 2.7, 0x303c3b], mail: [3.55, .72, 2.55, 0x35413e], mainframe: [4.2, 2.8, 3.1, 0x293536],
  storage: [3.7, 1.45, 2.85, 0x303f3c], nas: [3.65, 1.05, 2.75, 0x35433f], backup: [3.65, 1.05, 2.75, 0x39443f], cloud: [3.8, .72, 2.5, 0x2e4842], client: [2.8, .42, 1.8, 0x38433f],
});
const STATUS = Object.freeze({ healthy: 0x077165, warning: 0x8b5100, overloaded: 0xb83c34, unknown: 0x697286, invalid: 0xb83c34, disabled: 0x697286 });
const STORAGE_KINDS = new Set(['server', 'web', 'vm', 'db', 'mail', 'mainframe', 'storage', 'nas', 'backup']);
const SECURITY_KINDS = new Set(['firewall', 'ips', 'waf', 'vpn', 'sslvpn', 'lb']);

function material(color, options = {}) {
  const { map, transparent, opacity, side } = options;
  return new THREE.MeshBasicMaterial({ color, map, transparent, opacity, side });
}

function frontMesh(geometry, surface, x, y, z) {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(x, y, z);
  return mesh;
}

function makeLabel(device, status) {
  const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 144;
  const context = canvas.getContext('2d'); context.fillStyle = 'rgba(247,250,247,.96)'; context.fillRect(0, 0, 640, 144);
  context.fillStyle = '#13241f'; context.font = '600 38px Pretendard, sans-serif'; context.textAlign = 'left'; context.fillText(device.name, 28, 55);
  const detail = [device.vendor, device.model || device.kind].filter(Boolean).join(' · ').toUpperCase();
  context.fillStyle = '#4a635a'; context.font = '600 20px ui-monospace, Menlo, monospace'; context.fillText(detail.slice(0, 44), 28, 100);
  context.fillStyle = status; context.fillRect(0, 132, 640, 12);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.scale.set(5.8, 1.3, 1); return sprite;
}

function faceTexture(device, status, selected) {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 256;
  const context = canvas.getContext('2d'); const accent = '#' + STATUS[status].toString(16).padStart(6, '0');
  const gradient = context.createLinearGradient(0, 0, 0, 256); gradient.addColorStop(0, '#36423e'); gradient.addColorStop(.12, '#18231f'); gradient.addColorStop(1, '#0b1311');
  context.fillStyle = gradient; context.fillRect(0, 0, 1024, 256);
  context.fillStyle = '#0a100e'; context.fillRect(0, 0, 72, 256); context.fillRect(952, 0, 72, 256);
  context.strokeStyle = selected ? '#b8e737' : '#54635e'; context.lineWidth = selected ? 9 : 3; context.strokeRect(4, 4, 1016, 248);
  for (const x of [28, 996]) for (const y of [28, 228]) { context.fillStyle = '#050807'; context.beginPath(); context.arc(x, y, 9, 0, Math.PI * 2); context.fill(); context.strokeStyle = '#74817d'; context.lineWidth = 2; context.stroke(); }
  context.textAlign = 'left'; context.fillStyle = '#dceae2'; context.font = '700 29px Pretendard, sans-serif'; context.fillText(device.name.slice(0, 22), 94, 58);
  context.fillStyle = '#84968f'; context.font = '600 18px ui-monospace, Menlo, monospace'; context.fillText(String(device.model || device.kind).toUpperCase().slice(0, 28), 94, 91);
  const drawLed = (x, y, color) => { context.fillStyle = color; context.shadowColor = color; context.shadowBlur = 12; context.beginPath(); context.arc(x, y, 7, 0, Math.PI * 2); context.fill(); context.shadowBlur = 0; };
  drawLed(112, 129, device.active ? accent : '#58635f'); drawLed(138, 129, device.active ? '#43c894' : '#58635f');
  if (STORAGE_KINDS.has(device.kind)) {
    const rows = device.kind === 'storage' || device.kind === 'db' ? 3 : 2; const columns = 8; const left = 286; const top = 28; const width = 75; const height = (198 - (rows - 1) * 10) / rows;
    for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
      const x = left + column * (width + 9); const y = top + row * (height + 10); context.fillStyle = '#1d2925'; context.fillRect(x, y, width, height); context.strokeStyle = '#4c5c56'; context.lineWidth = 2; context.strokeRect(x, y, width, height);
      context.fillStyle = '#83918c'; context.fillRect(x + 9, y + height * .45, 18, 5); if ((row + column) % 4 === 0 && device.active) drawLed(x + width - 12, y + 13, '#43c894');
    }
  } else {
    const switchLike = ['switch', 'hub', 'router'].includes(device.kind); const count = switchLike ? 20 : SECURITY_KINDS.has(device.kind) ? 10 : 6; const columns = Math.ceil(count / (switchLike ? 2 : 1));
    for (let index = 0; index < count; index += 1) {
      const row = switchLike ? index % 2 : 0; const column = Math.floor(index / (switchLike ? 2 : 1)); const x = 330 + column * Math.min(58, 580 / columns); const y = 90 + row * 67;
      context.fillStyle = '#030706'; context.fillRect(x, y, 39, 31); context.strokeStyle = '#50635c'; context.lineWidth = 2; context.strokeRect(x, y, 39, 31); context.fillStyle = '#182a24'; context.fillRect(x + 6, y + 5, 27, 5);
      if (device.active && column % 3 === 0) drawLed(x + 32, y + 25, accent);
    }
    if (!switchLike) for (let index = 0; index < 22; index += 1) { context.fillStyle = index % 2 ? '#26342f' : '#101916'; context.beginPath(); context.arc(735 + (index % 11) * 19, 173 + Math.floor(index / 11) * 20, 4, 0, Math.PI * 2); context.fill(); }
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; return texture;
}

function makeDevice(device, selected) {
  const [width, height, depth, color] = PROFILES[device.kind] || [2.8, 1.1, 2.0, 0x47645d];
  const status = device.active ? device.primaryStatus : 'disabled'; const group = new THREE.Group(); group.userData = { deviceId: device.id, pickable: true };
  const front = depth / 2 + .035; const accent = STATUS[status];
  const shellMaterial = material(device.active ? color : 0x59635f, { roughness: .42, metalness: .62 });
  const plateMaterial = material(0xffffff, { map: faceTexture(device, status, selected), roughness: .4, metalness: .28 });
  const chassis = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), [shellMaterial, shellMaterial, shellMaterial, shellMaterial, plateMaterial, shellMaterial]);
  chassis.position.y = height / 2; chassis.userData = group.userData; group.add(chassis);
  const edges = new THREE.LineSegments(new THREE.EdgesGeometry(chassis.geometry, 35), new THREE.LineBasicMaterial({ color: 0x09100e, transparent: true, opacity: .7 })); edges.position.copy(chassis.position); group.add(edges);
  const railMaterial = material(accent, { emissive: accent, emissiveIntensity: device.active ? (selected ? 1.25 : .55) : 0 });
  for (const side of [-1, 1]) {
    const ear = frontMesh(new THREE.BoxGeometry(.16, height * .94, .08), material(0x121b18, { metalness: .76 }), side * (width / 2 + .06), height / 2, front); group.add(ear);
    for (const y of [height * .24, height * .76]) { const screw = new THREE.Mesh(new THREE.CylinderGeometry(.04, .04, .025, 12), material(0x85928e, { metalness: .95, roughness: .2 })); screw.rotation.x = Math.PI / 2; screw.position.set(side * (width / 2 + .06), y, front + .06); group.add(screw); }
  }
  if (device.kind === 'wireless') for (const side of [-1, 1]) {
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, 1.35, 6), railMaterial); antenna.position.set(side * width * .28, height + .5, 0); antenna.rotation.z = side * -.22; group.add(antenna);
  }
  const statusLed = new THREE.Mesh(new THREE.SphereGeometry(.055, 12, 8), railMaterial); statusLed.position.set(-width * .32, height * .5, front + .08); group.add(statusLed);
  if (selected) {
    const halo = new THREE.Mesh(new THREE.BoxGeometry(width + .18, height + .18, depth + .18), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: .17, side: THREE.BackSide })); halo.position.y = height / 2; group.add(halo);
  }
  const label = makeLabel(device, '#' + STATUS[status].toString(16).padStart(6, '0')); label.position.set(0, height + 1.05, 0); label.userData = group.userData; group.add(label);
  return group;
}

function makeLink(from, to, status, active, selected) {
  const start = from.point.clone(); const end = to.point.clone(); start.y += from.height * .56; end.y += to.height * .56; start.z += from.depth / 2 + .08; end.z += to.depth / 2 + .08;
  const rise = Math.max(start.y, end.y) + (selected ? 1.4 : .65); const midpoint = start.clone().lerp(end, .5).setY(rise);
  const curve = new THREE.QuadraticBezierCurve3(start, midpoint, end); const color = STATUS[status] || 0x5b8076; const cable = new THREE.Group();
  const sheath = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, selected ? .105 : .075, 6, false), material(0x111916, { roughness: .72, metalness: .08 })); cable.add(sheath);
  const tracer = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, selected ? .052 : .028, 5, false), material(color, { emissive: color, emissiveIntensity: active ? (selected ? 1.1 : .32) : 0, roughness: .36 })); cable.add(tracer);
  return { mesh: cable, curve };
}

export function createSpatialScene({ host, canvas, labels, onSelect, onViewChange, initialView, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' }); renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdceae2); scene.fog = new THREE.Fog(0xdceae2, 65, 115);
  const camera = new THREE.PerspectiveCamera(44, 1, .1, 200); const world = new THREE.Group(); scene.add(world);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(90, 60), material(0xc5d7cf, { roughness: .72, metalness: .08 })); ground.rotation.x = -Math.PI / 2; world.add(ground);
  const grid = new THREE.GridHelper(90, 90, 0x7f9b90, 0xafc4ba); grid.position.y = .012; grid.material.transparent = true; grid.material.opacity = .32; world.add(grid);
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); let pickables = []; let packets = [];
  const defaults = { yaw: -28, pitch: 38, distance: 31 };
  const view = { yaw: THREE.MathUtils.degToRad(initialView?.yaw ?? defaults.yaw), pitch: THREE.MathUtils.degToRad(initialView?.pitch ?? defaults.pitch), distance: initialView?.distance ?? defaults.distance, target: new THREE.Vector3() }; let dragging = null; let raf = 0; let active = false; let last = performance.now(); let reduce = reducedMotion;
  function placeCamera() { const cp = Math.cos(view.pitch); camera.position.set(Math.sin(view.yaw) * cp * view.distance, Math.sin(view.pitch) * view.distance, Math.cos(view.yaw) * cp * view.distance); camera.lookAt(view.target); }
  function resize() { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 1.25)); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
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
    for (const device of devices) { const selected = device.id === selectedId; const profile = PROFILES[device.kind] || [2.8, 1.1, 2.0]; const mesh = makeDevice(device, selected); mesh.position.set((device.position.x - centerX) / 28, selected ? .45 : .08, (device.position.y - centerY) / 28); positions.set(device.id, { point: mesh.position.clone(), height: profile[1], depth: profile[2] }); world.add(mesh); pickables.push(...mesh.children.filter((child) => child.isMesh || child.isSprite)); }
    const connected = new Set(links.filter((link) => link.source === selectedId || link.target === selectedId).map((link) => link.id));
    for (const link of links) { const from = positions.get(link.source); const to = positions.get(link.target); if (!from || !to) continue; const status = link.severed ? 'disabled' : link.primaryStatus || 'healthy'; const selected = connected.has(link.id); const result = makeLink(from, to, status, !link.severed, selected); world.add(result.mesh); if (!link.severed && (selected || (link.axes?.forwarding_bps?.utilization ?? 0) > 0)) { const dot = new THREE.Mesh(new THREE.SphereGeometry(selected ? .17 : .13, 8, 6), material(STATUS[status])); world.add(dot); packets.push({ dot, curve: result.curve, t: Math.random(), speed: .08 + Math.min(link.axes?.forwarding_bps?.utilization ?? 0, 1) * .16 }); } }
    labels.textContent = selectedId ? 'PHYSICAL PATH · ' + devices.length + ' DEVICES · ' + links.length + ' CABLES' : devices.length + ' DEVICES · ' + links.length + ' CABLES · EQUIPMENT VIEW';
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
  return { start() { if (active) return; active = true; last = performance.now(); resize(); raf = requestAnimationFrame(renderFrame); }, stop() { active = false; cancelAnimationFrame(raf); }, update, orbit, reset, zoom, setReducedMotion(value) { reduce = Boolean(value); }, dispose() { observer.disconnect(); clearWorld(); renderer.dispose(); }, debug() { return { renderer: 'WebGLRenderer', style: 'equipment-diorama', lighting: 'unlit', meshes: pickables.length, packets: packets.length, camera: camera.position.toArray(), canvas: [canvas.width, canvas.height], reducedMotion: reduce, view: { yaw: THREE.MathUtils.radToDeg(view.yaw), pitch: THREE.MathUtils.radToDeg(view.pitch), distance: view.distance } }; } };
}
