import * as THREE from '/vendor/three.module.js';

const COLORS = Object.freeze({ frame: 0x17352f, rail: 0x496b62, device: 0x315f57, mapped: 0x087d70, selected: 0xb8e737, offline: 0x697286, cable: [0x25a98f, 0x8dbd32, 0x5b7f75], warningCable: 0xd28a22, downCable: 0xb83c34 });
const CABINET = Object.freeze({ width: 5, height: 12, depth: 3.4 });

function labelSprite(text) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d'); context.fillStyle = 'rgba(247,250,247,.96)'; context.fillRect(0, 0, 512, 96);
  context.fillStyle = '#13241f'; context.font = '600 34px Pretendard, sans-serif'; context.textAlign = 'center'; context.fillText(text, 256, 58);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.scale.set(5.2, .98, 1); return sprite;
}

function cabinet(rack, views, selectedId) {
  const group = new THREE.Group();
  const { width, height, depth } = CABINET; const post = .14;
  const frameMaterial = new THREE.MeshStandardMaterial({ color: COLORS.frame, roughness: .32, metalness: .62 });
  const railMaterial = new THREE.MeshStandardMaterial({ color: COLORS.rail, roughness: .4, metalness: .45 });
  const addBox = (w, h, d, x, y, z, material = frameMaterial) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh); return mesh;
  };
  for (const x of [-width / 2, width / 2]) for (const z of [-depth / 2, depth / 2]) addBox(post, height, post, x, height / 2, z);
  for (const y of [0, height]) { addBox(width + post, post, post, 0, y, -depth / 2); addBox(width + post, post, post, 0, y, depth / 2); addBox(post, post, depth, -width / 2, y, 0); addBox(post, post, depth, width / 2, y, 0); }
  addBox(width + .7, .12, depth + .7, 0, -.08, 0, railMaterial);
  const unit = height / rack.capacityU;
  for (let marker = 1; marker < rack.capacityU; marker += 1) {
    const line = addBox(width - .35, .012, .018, 0, marker * unit, depth / 2 + .018, railMaterial);
    line.material = line.material.clone(); line.material.transparent = true; line.material.opacity = marker % 5 === 0 ? .55 : .18;
  }
  for (const view of views) {
    const itemHeight = Math.max(.14, view.uHeight * unit - .04);
    const y = (view.startU - 1) * unit + itemHeight / 2 + .02;
    const color = !view.active ? COLORS.offline : view.mapped ? COLORS.mapped : COLORS.device;
    const selected = view.id === selectedId;
    const material = new THREE.MeshStandardMaterial({ color, roughness: .32, metalness: .45, emissive: selected ? COLORS.selected : color, emissiveIntensity: selected ? .6 : .08 });
    const mesh = addBox(width - .42, itemHeight, depth - .36, 0, y, 0, material);
    mesh.userData = { rackId: rack.id, placementId: view.id, pickable: true };
    for (let port = 0; port < Math.min(10, Math.max(3, view.uHeight * 4)); port += 1) {
      const lamp = addBox(.18, .08, .04, -1.7 + port * .36, y, depth / 2 - .15, new THREE.MeshStandardMaterial({ color: port % 3 === 0 ? COLORS.selected : 0x0d2420, emissive: port % 3 === 0 ? COLORS.selected : 0x000000, emissiveIntensity: .55 }));
      lamp.userData = mesh.userData;
    }
  }
  const label = labelSprite(rack.name); label.position.set(0, height + .8, 0); group.add(label);
  return group;
}

function cableColor(status, colorIndex = 0) {
  return status === 'disabled' || status === 'invalid' ? COLORS.downCable : status === 'warning' || status === 'overloaded' ? COLORS.warningCable : COLORS.cable[colorIndex % COLORS.cable.length];
}

function cableMaterial(status, colorIndex = 0) {
  const color = cableColor(status, colorIndex);
  return new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: status === 'disabled' ? .08 : .28, roughness: .46, metalness: .05, transparent: status === 'disabled', opacity: status === 'disabled' ? .5 : 1 });
}

function cableTube(points, status, count = 1, colorIndex = 0) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'catmullrom', .35);
  const radius = Math.min(.13, .045 + Math.max(0, count - 1) * .012);
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, radius, 8, false), cableMaterial(status, colorIndex));
  mesh.userData = { cable: true, cableCount: count, status }; return mesh;
}

function patchCord(points, status, colorIndex = 0) {
  const group = new THREE.Group(); group.userData = { cable: true, cableCount: 1, cableKind: 'patch' };
  group.add(cableTube(points, status, 1, colorIndex));
  const color = cableColor(status, colorIndex);
  for (const point of [points[0], points.at(-1)]) {
    const socket = new THREE.Mesh(new THREE.BoxGeometry(.28, .17, .12), new THREE.MeshStandardMaterial({ color: 0x10231f, roughness: .48, metalness: .35 }));
    socket.position.copy(point); socket.position.z += .035; group.add(socket);
    const plug = new THREE.Mesh(new THREE.BoxGeometry(.16, .09, .13), new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: .2, roughness: .42 }));
    plug.position.copy(point); plug.position.z -= .035; group.add(plug);
  }
  return group;
}

function stableSlot(deviceId, linkId) {
  let hash = 0; const value = `${deviceId}:${linkId}`;
  for (let index = 0; index < value.length; index += 1) hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  return Math.abs(hash) % 7;
}

function cableRoutes(racks, links, positions) {
  const endpoints = new Map();
  racks.forEach(({ rack, placements }, rackIndex) => {
    const x = positions.get(rack.id); const unit = CABINET.height / rack.capacityU;
    for (const placement of placements.filter(({ deviceId }) => deviceId)) endpoints.set(placement.deviceId, { rackId: rack.id, rackIndex, x, y: (placement.startU - 1 + placement.uHeight / 2) * unit, z: -CABINET.depth / 2 - .16 });
  });
  const eligible = (links || []).flatMap((link, index) => {
    const from = endpoints.get(link.source); const to = endpoints.get(link.target);
    if (!from || !to) return [];
    const port = (endpoint, deviceId) => ({ ...endpoint, portX: endpoint.x - 1.44 + stableSlot(deviceId, link.id) * .48 });
    return [{ link, index, from: port(from, link.source), to: port(to, link.target) }];
  });
  // 많은 랙 간 링크는 같은 트레이 경로를 공유한다. 여섯 개를 넘으면 중앙 높이의 번들 하나로 합친다.
  const groups = new Map();
  for (const edge of eligible) { const key = edge.from.rackId === edge.to.rackId ? edge.link.id : [edge.from.rackId, edge.to.rackId].sort().join(':'); if (!groups.has(key)) groups.set(key, []); groups.get(key).push(edge); }
  return [...groups.values()].map((edges, groupIndex) => {
    const bundled = edges.length > 6; const edge = edges[0];
    const from = bundled ? { ...edge.from, y: edges.reduce((sum, item) => sum + item.from.y, 0) / edges.length } : edge.from;
    const to = bundled ? { ...edge.to, y: edges.reduce((sum, item) => sum + item.to.y, 0) / edges.length } : edge.to;
    const disabled = edges.every(({ link }) => link.severed);
    const warning = edges.some(({ link }) => ['warning', 'overloaded', 'invalid'].includes(link.primaryStatus));
    const status = disabled ? 'disabled' : warning ? 'warning' : 'healthy';
    const sameRack = from.rackId === to.rackId; const rear = -CABINET.depth / 2 - .28;
    if (sameRack) {
      const start = new THREE.Vector3(from.portX, from.y, from.z);
      const end = new THREE.Vector3(to.portX, to.y, to.z);
      const distance = Math.abs(from.y - to.y);
      const sag = Math.min(2.2, .55 + distance * .2);
      const low = Math.max(.22, Math.min(from.y, to.y) - sag);
      const bow = (groupIndex % 2 ? 1 : -1) * (.28 + (groupIndex % 3) * .12);
      const points = [start, new THREE.Vector3(start.x, start.y, rear - .32), new THREE.Vector3((start.x + end.x) / 2 + bow, low, rear - .72), new THREE.Vector3(end.x, end.y, rear - .32), end];
      return patchCord(points, status, groupIndex);
    }
    const points = [new THREE.Vector3(from.portX, from.y, from.z), new THREE.Vector3(from.x + CABINET.width / 2 - .22, from.y, rear), new THREE.Vector3(from.x + CABINET.width / 2 - .22, CABINET.height + .42, rear), new THREE.Vector3(to.x - CABINET.width / 2 + .22, CABINET.height + .42, rear), new THREE.Vector3(to.x - CABINET.width / 2 + .22, to.y, rear), new THREE.Vector3(to.portX, to.y, to.z)];
    const tray = cableTube(points, status, edges.length, groupIndex); tray.userData.cableKind = 'tray'; return tray;
  });
}

export function createRackScene({ host, canvas, onSelect, reducedMotion = false }) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xdceae2); scene.fog = new THREE.Fog(0xdceae2, 45, 95);
  const camera = new THREE.PerspectiveCamera(40, 1, .1, 160); const world = new THREE.Group(); scene.add(world);
  scene.add(new THREE.HemisphereLight(0xf4fbf7, 0x16332d, 2.4));
  const key = new THREE.DirectionalLight(0xffffff, 3.2); key.position.set(-18, 28, 24); key.castShadow = true; key.shadow.mapSize.set(1024, 1024); scene.add(key);
  const rim = new THREE.DirectionalLight(0xb8e737, .9); rim.position.set(20, 12, -15); scene.add(rim);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 45), new THREE.MeshStandardMaterial({ color: 0xc9d9d1, roughness: .88 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; world.add(ground);
  const grid = new THREE.GridHelper(80, 40, 0x9eb9ad, 0xbfd1c8); grid.position.y = .01; grid.material.transparent = true; grid.material.opacity = .38; world.add(grid);
  const raycaster = new THREE.Raycaster(); const pointer = new THREE.Vector2(); const view = { yaw: -.48, pitch: .58, distance: 24 };
  let dragging = null; let active = false; let frame = 0; let reduce = reducedMotion; let pickables = []; let face = 'front'; let cableCount = 0; let patchCableCount = 0; let trayBundleCount = 0;
  function placeCamera() { const cp = Math.cos(view.pitch); camera.position.set(Math.sin(view.yaw) * cp * view.distance, 6 + Math.sin(view.pitch) * view.distance, Math.cos(view.yaw) * cp * view.distance); camera.lookAt(0, 6, 0); }
  function resize() { const width = Math.max(1, host.clientWidth); const height = Math.max(1, host.clientHeight); renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix(); }
  function renderFrame() { if (!active) return; placeCamera(); renderer.render(scene, camera); frame = requestAnimationFrame(renderFrame); }
  function disposeObject(object) { object.traverse((child) => { child.geometry?.dispose(); const materials = Array.isArray(child.material) ? child.material : child.material ? [child.material] : []; for (const material of materials) { for (const value of Object.values(material)) if (value?.isTexture) value.dispose(); material.dispose(); } }); }
  function clear() { for (const child of [...world.children].slice(2)) { world.remove(child); disposeObject(child); } pickables = []; }
  function update({ racks, links = [], selectedPlacementId, showCables = false }) {
    clear(); const spacing = 7.3; const center = (racks.length - 1) * spacing / 2; const positions = new Map();
    racks.forEach(({ rack, placements }, index) => { const x = index * spacing - center; positions.set(rack.id, x); const group = cabinet(rack, placements, selectedPlacementId); group.position.x = x; world.add(group); group.traverse((child) => { if (child.userData.pickable || child.userData.placementId) pickables.push(child); }); });
    const cables = showCables ? cableRoutes(racks, links, positions) : []; cables.forEach((cable) => world.add(cable)); cableCount = cables.reduce((sum, cable) => sum + cable.userData.cableCount, 0); patchCableCount = cables.filter(({ userData }) => userData.cableKind === 'patch').length; trayBundleCount = cables.filter(({ userData }) => userData.cableKind === 'tray').length;
    view.distance = Math.max(20, 18 + racks.length * 3.3);
  }
  function pick(event) { const box = canvas.getBoundingClientRect(); pointer.x = ((event.clientX - box.left) / box.width) * 2 - 1; pointer.y = -((event.clientY - box.top) / box.height) * 2 + 1; raycaster.setFromCamera(pointer, camera); const hit = raycaster.intersectObjects(pickables, false).find(({ object }) => object.userData.placementId); if (hit) onSelect(hit.object.userData); }
  canvas.addEventListener('pointerdown', (event) => { dragging = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; canvas.setPointerCapture(event.pointerId); });
  canvas.addEventListener('pointermove', (event) => { if (!dragging || dragging.id !== event.pointerId) return; const dx = event.clientX - dragging.x; const dy = event.clientY - dragging.y; dragging.moved ||= Math.hypot(dx, dy) > 3; view.yaw -= dx * .007; view.pitch = THREE.MathUtils.clamp(view.pitch - dy * .006, .18, 1.2); dragging.x = event.clientX; dragging.y = event.clientY; });
  canvas.addEventListener('pointerup', (event) => { if (!dragging || dragging.id !== event.pointerId) return; if (!dragging.moved) pick(event); dragging = null; });
  canvas.addEventListener('wheel', (event) => { event.preventDefault(); view.distance = THREE.MathUtils.clamp(view.distance * Math.exp(event.deltaY * .001), 14, 70); }, { passive: false });
  const observer = new ResizeObserver(resize); observer.observe(host); resize();
  return { update, setFace(next) { if (!['front', 'rear'].includes(next) || face === next) return; face = next; view.yaw = face === 'rear' ? Math.PI - .48 : -.48; }, start() { if (active) return; active = true; resize(); frame = requestAnimationFrame(renderFrame); }, stop() { active = false; cancelAnimationFrame(frame); }, reset() { view.yaw = face === 'rear' ? Math.PI - .48 : -.48; view.pitch = .58; }, orbit(dx, dy) { view.yaw += dx; view.pitch = THREE.MathUtils.clamp(view.pitch + dy, .18, 1.2); }, setReducedMotion(value) { reduce = Boolean(value); }, dispose() { observer.disconnect(); clear(); renderer.dispose(); }, debug() { return { renderer: 'WebGLRenderer', racks: world.children.filter((child) => !child.userData.cable).length - 2, meshes: pickables.length, cables: cableCount, patchCables: patchCableCount, trayBundles: trayBundleCount, face, reducedMotion: reduce }; } };
}
