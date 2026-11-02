// 중계 서버 (Cloudflare Workers + Durable Objects, worker/ 폴더). wss 443 이라 학교 · 회사망에서도 된다.
// 비어 있으면 서버 없이 방장 브라우저가 서버 역할 (같은 브라우저 탭 · WebRTC).
// 시험할 때는 주소창에 ?server=ws://127.0.0.1:8787 처럼 넘겨도 된다.
export const SERVER_URL = '';
