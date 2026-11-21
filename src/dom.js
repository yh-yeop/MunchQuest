// 화면 쪽 작은 도구: 요소 찾기 · 저장(localStorage 가 막힌 환경에서도 오류 없이)
export const $ = (id) => document.getElementById(id);
export const store = {
  get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 저장 불가 환경 무시 */ } },
};
