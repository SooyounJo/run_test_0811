# run0809-web

Next.js Pages Router + Yarn. **가벼운 2단계 흐름**만 사용합니다.

## 흐름

1. **go** → `POST /api/runpod/run` (RunPod에 `{ input: { prompt } }` 전송, `job id` 수신)
2. 브라우저가 `GET /api/runpod/status/[id]` 를 주기적으로 조회
3. `COMPLETED` 이면 응답의 `images[0]` 을 화면 중앙에 표시

서버는 RunPod에 **신호만 대신 보내고**, **완료까지 기다리지 않습니다** (긴 HTTP 한 방 X).

## 시작

```bash
yarn install --ignore-optional
yarn dev
```

`.env.local` — `.env.local.example` 참고 (`RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`).

## 스크립트

- `yarn dev` / `yarn build` / `yarn start` / `yarn lint`
