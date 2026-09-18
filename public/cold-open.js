// 처음 온 사람을 위한 도입 시연.
//
// 첫 화면은 세 칸짜리 고밀도 작업판이다 - 인프라를 아는 사람에게는 바로 읽히지만, 처음 온
// 사람에게는 읽을 순서가 없다. 그래서 설명을 덧붙이는 대신 도구가 한 번 해 보인다.
//
// 문구로 주장하지 않는다. 장애는 흉내 내지 않고 실제로 주입하고, 피해 숫자는 이 파일이 쓰지
// 않고 엔진이 계산한 값을 받아 적는다 - 여기서 지어낸 숫자를 쓰면 이 도구가 하는 말이 무너진다.
//
// 앱 내부를 직접 참조하지 않는다. 장애 전환·피해 조회·손을 넘길 곳은 호출한 쪽이 넘긴다. 시연이
// 끝나면 주입한 장애를 되돌리고 조작을 넘긴다. 건너뛰기와 ESC는 항상 열려 있다.

export function startColdOpen(api) {
  if (document.getElementById('cold-open')) return null;
  const { t, deviceIds = [], deviceNames = [], domainLabel = '', primary = 'try', fault, damage, onTry, onGuide, onEnd } = api;
  // 움직임을 줄이겠다고 한 사람에게는 장면이 저절로 넘어가지 않는다. 읽는 속도를 그 사람이 정한다.
  const manual = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const root = document.createElement('div');
  root.id = 'cold-open';
  root.innerHTML = `
    <svg class="cold-open-tether" aria-hidden="true"><g></g></svg>
    <div class="cold-open-rail" role="region" aria-live="polite" aria-label="${escapeAttribute(t('coldOpen.label'))}">
      <p class="cold-open-tag"><span>HEADROOM</span><b class="cold-open-count"></b></p>
      <h2 class="cold-open-line"></h2>
      <p class="cold-open-text"></p>
      <p class="cold-open-damage" hidden></p>
      <div class="cold-open-bar"><i></i></div>
      <div class="cold-open-actions">
        <span class="cold-open-handoff" hidden>
          <button type="button" data-cold-open="try" class="${primary === 'try' ? 'is-primary' : ''}">${escapeText(t('coldOpen.try'))}</button>
          <button type="button" data-cold-open="guide" class="${primary === 'guide' ? 'is-primary' : ''}">${escapeText(t('coldOpen.guide'))}</button>
        </span>
        <button type="button" data-cold-open="next" class="is-primary" hidden>${escapeText(t('coldOpen.next'))}</button>
        <button type="button" data-cold-open="skip">${escapeText(t('coldOpen.skip'))}</button>
      </div>
    </div>`;
  document.body.appendChild(root);
  document.body.classList.add('cold-open-running');

  const part = (selector) => root.querySelector(selector);
  const rail = part('.cold-open-rail');

  // 레일은 캔버스 열 가운데, 요약 스트립 바로 아래에 선다. 화면 아래에 두면 장비 카드에서
  // 400px 넘게 떨어져 눈에 들어오지 않고 캔버스 설명까지 덮는다. 위에 붙이면 피해 숫자가
  // 적히는 요약 스트립과 붙어 있어 문장과 숫자를 한눈에 잇는다. 장비 카드는 가리지 않는다.
  // 좁은 화면에서는 스타일시트가 레일을 아래로 내린다 - 세로로 쌓인 화면에서는 캔버스가 요약보다 한참 아래다.
  const placeRail = () => {
    const panel = document.querySelector('.topology-panel');
    const strip = document.querySelector('.summary-strip');
    const box = panel ? panel.getBoundingClientRect() : { left: 0, width: window.innerWidth };
    const width = Math.min(700, box.width - 40);
    rail.style.width = `${width}px`;
    rail.style.left = `${box.left + (box.width - width) / 2}px`;
    rail.style.top = `${Math.max(12, (strip ? strip.getBoundingClientRect().bottom : 56) + 10)}px`;
  };

  const nodeFor = (id) => document.querySelector(`.mesh-node[data-device-id="${CSS.escape(id)}"]`);
  const nodes = () => Array.from(document.querySelectorAll('.mesh-node[data-device-id]'));
  const focus = (ids) => nodes().forEach((node) => {
    const lit = !ids || ids.includes(node.dataset.deviceId);
    node.classList.toggle('cold-open-dim', Boolean(ids) && !lit);
    node.classList.toggle('cold-open-lit', Boolean(ids) && lit);
  });

  // 가리키는 장비가 화면 밖이면 문장이 허공을 가리킨다. 캔버스와 페이지를 필요한 만큼만 굴려
  // 장비를 레일에 가리지 않는 띠 안에 넣는다. 이미 보이면 건드리지 않는다.
  const shiftInto = (start, end, low, high) => (start >= low && end <= high ? 0 : (start + end) / 2 - (low + high) / 2);
  const spanOf = (ids) => {
    const boxes = ids.map(nodeFor).filter(Boolean).map((node) => node.getBoundingClientRect());
    if (!boxes.length) return null;
    return {
      left: Math.min(...boxes.map((box) => box.left)), right: Math.max(...boxes.map((box) => box.right)),
      top: Math.min(...boxes.map((box) => box.top)), bottom: Math.max(...boxes.map((box) => box.bottom)),
    };
  };
  const reveal = (ids) => {
    const scroller = document.querySelector('.topology-scroll');
    let span = spanOf(ids);
    if (!span) return;
    if (scroller) {
      const view = scroller.getBoundingClientRect();
      scroller.scrollLeft += shiftInto(span.left, span.right, view.left, view.right);
      scroller.scrollTop += shiftInto(span.top, span.bottom, view.top, view.bottom);
      span = spanOf(ids);
    }
    const box = rail.getBoundingClientRect();
    const [low, high] = box.top > window.innerHeight / 2 ? [12, box.top - 12] : [box.bottom + 12, window.innerHeight - 12];
    window.scrollBy(0, shiftInto(span.top, span.bottom, low, high));
  };

  // 논리 뷰는 전원을 그리지 않는다. 두 대를 묶는 선을 잠깐 하나 그어야 "같은 전원"이 보인다.
  let tetherOn = false;
  const tether = (on) => {
    tetherOn = Boolean(on);
    const svg = part('.cold-open-tether');
    const group = svg.querySelector('g');
    group.textContent = '';
    svg.classList.toggle('is-on', tetherOn);
    if (!tetherOn || deviceIds.length < 2) return;
    const boxes = deviceIds.map(nodeFor).filter(Boolean).map((node) => node.getBoundingClientRect());
    if (boxes.length < 2) return;
    const [first, second] = boxes;
    const spine = Math.min(first.left, second.left) - 46;
    const topY = first.top + first.height / 2;
    const bottomY = second.top + second.height / 2;
    const ns = 'http://www.w3.org/2000/svg';
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', `M${first.left} ${topY} H${spine} V${bottomY} H${second.left}`);
    group.appendChild(path);
    if (!domainLabel) return;
    const midY = (topY + bottomY) / 2;
    const plate = document.createElementNS(ns, 'rect');
    const text = document.createElementNS(ns, 'text');
    text.setAttribute('x', spine);
    text.setAttribute('y', midY + 4);
    text.setAttribute('text-anchor', 'middle');
    text.textContent = domainLabel;
    group.append(plate, text);
    // 글자 수로 폭을 어림하면 한글·일본어처럼 폭이 넓은 글자에서 이름이 판 밖으로 샌다. 그린 폭을 잰다.
    const width = text.getComputedTextLength() + 16;
    plate.setAttribute('x', spine - width / 2);
    plate.setAttribute('y', midY - 10);
    plate.setAttribute('width', width);
    plate.setAttribute('height', 20);
    plate.setAttribute('rx', 3);
  };

  // 요약 스트립은 좁은 화면에서 가로로 넘친다. 가리키는 칸이 밖에 있으면 스트립만 가로로 당긴다.
  const SPOT_GROUPS = { delivery: 'summary-delivery', capacity: 'summary-capacity', headroom: 'summary-capacity' };
  const spotlight = (name) => {
    if (!name) { delete document.body.dataset.coldOpenSpot; return; }
    document.body.dataset.coldOpenSpot = name;
    const group = document.querySelector(`.summary-group.${SPOT_GROUPS[name]}`);
    const strip = group?.closest('.summary-strip');
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const groupBox = group.getBoundingClientRect();
    const stripBox = strip.getBoundingClientRect();
    strip.scrollLeft += (groupBox.left + groupBox.width / 2) - (stripBox.left + stripBox.width / 2);
  };

  let activeFault = null;
  const setFault = (kind) => {
    if (kind === activeFault) return;
    activeFault = kind;
    fault(kind);
  };

  // 장면마다 걸려 있어야 할 장애를 스스로 밝힌다. 앞 장면을 건너뛰고 들어와도 전제가 선다.
  // 장면 길이는 읽는 시간이지 기다리는 시간이 아니다. 빨리 읽는 사람은 눌러서 넘긴다.
  // 3번은 전환 비트다. 주입은 장면이 시작하는 순간 일어나므로 더 끌면 멈춘 화면만 보게 된다.
  // 공용 전원이 무너지는 것만 보이고 끝나면 "확인하라"는 말이 빈말이 된다. 전원을 나눈 경우를
  // 같은 엔진으로 한 번 더 계산해 보여 준다 - 경로는 살지만 남은 쪽이 넘친다.
  // 마지막 장면은 설계를 되돌리고 멈춘다. 장애를 켜 둔 채 기다리면 부하가 0이라 여유가 100%로 읽힌다.
  const scenes = [
    { key: 'one', ms: 4000, quiet: true },
    { key: 'two', ms: 5000, quiet: true, lit: deviceIds, tether: true },
    { key: 'three', ms: 2500, quiet: true, lit: deviceIds, tether: true, fault: 'shared' },
    { key: 'four', ms: 5500, fault: 'shared', spot: 'delivery', reading: 'damage' },
    { key: 'split', ms: 5500, fault: 'single', spot: 'capacity', reading: 'splitDamage' },
    { key: 'five', ms: 0, spot: 'headroom' },
  ];

  // 재계산은 동기라 장애를 바꾼 직후의 값이 곧 결과다. 기다렸다 읽으면 다음 장면의 값이 섞인다.
  const showReading = (key) => {
    const line = part('.cold-open-damage');
    const reading = key ? damage() : null;
    line.hidden = !reading;
    line.textContent = reading ? t(`coldOpen.${key}`, reading) : '';
  };

  let index = -1;
  let timer = null;
  let frame = null;
  const pause = () => { clearTimeout(timer); cancelAnimationFrame(frame); };

  const goto = (next) => {
    pause();
    index = Math.max(0, Math.min(scenes.length - 1, next));
    const scene = scenes[index];
    const last = index === scenes.length - 1;
    const values = { first: deviceNames[0] || deviceIds[0] || '', second: deviceNames[1] || deviceIds[1] || '', domain: domainLabel };
    part('.cold-open-count').textContent = t('coldOpen.count', { current: index + 1, total: scenes.length });
    part('.cold-open-line').textContent = t(`coldOpen.${scene.key}Line`, values);
    part('.cold-open-text').textContent = t(`coldOpen.${scene.key}Text`, values);
    setFault(scene.fault || null);
    focus(scene.lit || null);
    document.body.classList.toggle('cold-open-quiet', Boolean(scene.quiet));
    spotlight(scene.spot);
    placeRail();
    if (scene.lit) reveal(scene.lit);
    tether(scene.tether);
    showReading(scene.reading);
    part('.cold-open-handoff').hidden = !last;
    part('[data-cold-open="next"]').hidden = !manual || last;
    part('.cold-open-bar').hidden = manual || last;
    part('.cold-open-bar i').style.width = '0%';
    // 보이지 않는 탭에서는 시간을 흘리지 않는다. 돌아왔을 때 결론만 덩그러니 남지 않게 한다.
    if (!scene.ms || manual || document.hidden) return;
    const started = performance.now();
    const step = () => {
      const ratio = Math.min(1, (performance.now() - started) / scene.ms);
      part('.cold-open-bar i').style.width = `${(ratio * 100).toFixed(1)}%`;
      if (ratio < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    timer = setTimeout(() => goto(index + 1), scene.ms);
  };

  const end = () => {
    if (!root.isConnected) return;
    pause();
    setFault(null);
    focus(null);
    tether(false);
    spotlight(null);
    document.body.classList.remove('cold-open-running', 'cold-open-quiet');
    window.removeEventListener('resize', onLayout);
    window.removeEventListener('scroll', onLayout, true);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('click', onOutsideClick, true);
    document.removeEventListener('visibilitychange', onVisibility);
    root.remove();
    if (onEnd) onEnd();
  };

  // 안내에서 시작한 시연은 건너뛰어도 안내로 이어진다 - 둘은 한 흐름이다. ESC도 건너뛰기다.
  const finish = (action) => {
    end();
    if (action === 'try' && onTry) onTry();
    if (onGuide && (action === 'guide' || (action === 'skip' && primary === 'guide'))) onGuide();
  };

  function onLayout() {
    placeRail();
    if (tetherOn) tether(true);
  }

  function onKey(event) {
    if (event.key === 'Escape') { finish('skip'); return; }
    if (event.key === 'ArrowRight' && index < scenes.length - 1) goto(index + 1);
  }

  // 시연 막은 클릭을 통과시킨다. 그 사이 설계를 만지면 시연이 켠 장애와 사용자의 조작이
  // 섞이므로, 레일 밖을 누르는 순간 시연을 거두고 조작을 그대로 넘긴다.
  function onOutsideClick(event) {
    if (!rail.contains(event.target)) end();
  }

  function onVisibility() {
    if (document.hidden) pause();
    else goto(index);
  }

  root.addEventListener('click', (event) => {
    const action = event.target.closest('[data-cold-open]')?.dataset.coldOpen;
    if (action === 'next') { goto(index + 1); return; }
    if (action) { finish(action); return; }
    // 버튼이 아닌 곳을 누르면 다음 장면으로 간다. 다 읽은 사람을 남은 초만큼 붙잡지 않는다.
    if (event.target.closest('.cold-open-rail') && index < scenes.length - 1) goto(index + 1);
  });
  window.addEventListener('resize', onLayout);
  window.addEventListener('scroll', onLayout, true);
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onOutsideClick, true);
  document.addEventListener('visibilitychange', onVisibility);

  goto(0);
  return { goto, end };
}

function escapeText(value) {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeAttribute(value) {
  return escapeText(value).replace(/"/g, '&quot;');
}
