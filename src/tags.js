// 이름표 자리 잡기: 같은 자리 · 가까이 선 사람들의 이름표가 겹치면 위로 쌓는다.
// 내 이름표는 늘 제자리, 나머지는 id 순서로 놓는다 — 움직이는 순서(y)로 정하면 엇갈릴 때마다 자리가 바뀌어 깜빡인다.
// tags: [{ id, mine, x, y, w, h, below }] — x = 가운데, y = 글자 아래끝, h = 그 위 높이, below = 그 아래(체력 막대) 높이.
// 각 tag 의 y 를 고쳐서 돌려준다.
export function layoutTags(tags, gap = 1) {
  const order = [...tags].sort((a, b) => (b.mine ? 1 : 0) - (a.mine ? 1 : 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const placed = [];
  for (const t of order) {
    for (let n = 0; n <= placed.length; n++) {
      const hit = placed.find((p) => Math.abs(p.x - t.x) * 2 < p.w + t.w && t.y - t.h < bottom(p) + gap && p.y - p.h < bottom(t) + gap);
      if (!hit) break;
      t.y = hit.y - hit.h - gap - (t.below || 0);   // 부딪힌 이름표 바로 위로
    }
    placed.push(t);
  }
  return tags;
}

const bottom = (t) => t.y + (t.below || 0);
