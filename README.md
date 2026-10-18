# 왁뿌 시뮬레이터 (프로토타입)

사진을 왁뿌볼로 만들어 와작! 사진 속 대상을 톡 누르면 AI 가 그 대상을 젤리 왁스볼로 다시 그리고, 금 가게 하고 으깨고 던지고 안의 슬라임까지 만지며 논다.

## 실행

```bash
npm install
npm run dev
```

브라우저에서 터미널에 나온 주소(기본 http://localhost:5173)를 연다.

`.env.example` 을 `.env` 로 복사해서 `OPENAI_API_KEY` 를 넣는다. 왁뿌볼은 항상 AI 변환으로 만들기 때문에 키가 없으면 새로 만들 수 없다 (화면에는 "지금은 만들 수 없어요"만 보이고, 원인은 서버 로그에 남는다). 보관함·공유받은 볼·배경 젤리는 키 없이도 동작한다.

| 설정 | 설명 |
|---|---|
| `OPENAI_API_KEY` | 왁뿌볼을 만들 때마다 gpt-image-1-mini 이미지 편집 1회 호출 |
| `DAILY_LIMIT` | 하루 한정 왁뿌볼 수 (전체), 기본 100. 한국 시간 0시 초기화 |
| `PER_IP_DAILY` | 한 사람(IP)이 하루에 만들 수 있는 수, 기본 10 |

로컬에서는 수량을 `.data/usage.json`, 공유한 볼을 `.data/shared/` 에 기록한다.

## 놀이

- **만들기**: 누끼(브라우저) → AI 가 대상을 실루엣 그대로 젤리 왁스볼로 다시 그림. 실패하면 "다시 굳히기" 로 재시도. 이름·색·속재료·소리는 앱이 직접 정한다.
- **이름·아이콘**: 위쪽 이름 칸을 누르면 이름과 아이콘(이모지)을 바꿀 수 있다. 보관한 볼이면 보관함에도 반영.
- **톡** = 금 · **꾹** = 으깨기 · **끌기** = 던지기. 던지면 벽·바닥·천장에 부딪혀 튕기고, 세게 부딪히면 금이 간다. 누를 때마다 말랑하게 출렁·부르르 떨린다.
- 금이 12~18번 가면 와장창 + "부서졌다!". 안의 슬라임은 누르면 움푹, 끌면 쭉 늘어난다.
- **희귀볼**: 굳힐 때마다(다시 굳히기 포함) 5% 무지개 글리터, 1% 다이아몬드 슬라임. 전용 등장 연출이 있다. 개발 중에는 `?rare` / `?diamond` 로 확인.
- **보관함**: 오른쪽에 최대 10개 (브라우저 IndexedDB). 넓은 화면은 오른쪽 칸, 좁은 화면은 오른쪽 끝 서랍. 누르면 꺼내서 다시 논다. 꽉 차면 지울 왁뿌볼을 고르는 선택창이 뜬다.
- **사진 넣기**: 고르기·끌어다 놓기·Ctrl+V(⌘+V) 붙여넣기·붙여넣기 버튼.
- **공유**: 링크(`?ball=id`)를 만든다. 링크를 연 사람은 그 왁뿌볼을 그냥 가지고 놀거나 보관함에 담을 수 있다. 공유한 볼은 30일 뒤 사라진다.
- **효과음 글씨**: 톡·꾹 하면 "빠작!·콰작!·으직", 끌면 "뽀득", 슬라임을 늘이면 "쭈욱" 이 작게 랜덤으로 튀어나온다.
- **배경 젤리**: 버터·크런치 딸기·청사과 같은 인기 왁뿌볼과 젤리 도형이 떠다닌다. 톡 누르면 부서지고 다른 젤리가 나온다.

## 체험판 (claude.ai 아티팩트)

아티팩트에는 서버가 없어서 사진으로 만들기·공유·하루 한정 수량은 빠지고, 준비된 왁뿌볼 9종(`src/trial.ts`)으로 논다. 영상 저장은 아티팩트의 `downloads` 기능을 쓴다.

```bash
npm run dev:trial     # 체험판 모드로 미리 보기 (http://localhost:5180)
npm run build:trial   # dist-trial/wakppu-trial.html 한 장으로 묶기 → 아티팩트로 게시
```

게시된 체험판: https://claude.ai/artifact/JWEnubtWoLcp3CztuvJzLX

## 디자인

Y2K 젤리·유리 테마. 이미지 파일 없이 CSS 와 캔버스로만 그린다. 유리 카드, 옛 OS 창틀 제목 표시줄, 젤리 버튼, 코스틱 빛, 색 그림자. `prefers-reduced-motion` 이면 움직임을 끈다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/main.ts` | 화면 흐름, 놀이판, 보관함, 공유, 선택창 |
| `src/segment.ts` | 브라우저 누끼 (MediaPipe Interactive Segmenter) |
| `src/design.ts` | 이름·색·속재료·소리를 앱이 직접 결정 |
| `src/ballRender.ts` | AI 결과를 껍질 규격으로 정리 / 배경 젤리용 실루엣 왁스 셰이딩 |
| `src/waxBall.ts` | 놀이판 엔진: 금·으깨기·끌기·던지기·충돌·파편·슬로모·영상 녹화 |
| `src/goo.ts` | 누르고 늘이는 슬라임 소프트바디 |
| `src/fillingRender.ts` | 속재료 그리기 (슬라임·점토·반짝이·무지개·다이아몬드) |
| `src/rareFx.ts` | 희귀 확률과 등장 연출 |
| `src/popText.ts` | "부서졌다!" 같은 젤리 글씨 |
| `src/jellyField.ts`, `src/jellyShapes.ts` | 배경에 떠다니며 부서지는 젤리 |
| `src/bgFx.ts` | 배경 코스틱 빛 |
| `src/store.ts` | 보관함 (IndexedDB, 최대 10개) |
| `src/sound.ts` | Web Audio 로 합성한 효과음 (음원 파일 없음) |
| `src/sfxWords.ts` | "빠작!" 같은 효과음 글씨 |
| `server/core.ts` | API 본체 (`/api/status`, `/api/waxify`, `/api/share`) — 웹 표준만 써서 로컬·Cloudflare 공용 |
| `server/node.ts` | 로컬 개발용: Vite 미들웨어 + 파일 저장소 |
| `worker/index.ts` | Cloudflare 배포판: Worker + Durable Object(하루 수량·공유한 볼) |
| `wrangler.jsonc` | Cloudflare 설정 (정적 파일, Durable Object, 분당 요청 제한, 수량 변수) |
| `public/_headers` | 배포판 보안 헤더 (CSP 등)·캐시 |

## 배포 (GitHub → Cloudflare Workers)

GitHub 저장소를 Cloudflare 에 연결해 두면 `main` 에 올릴 때마다 자동으로 빌드·배포된다.

1. Cloudflare 대시보드 → **Workers & Pages** → **Create** → **Import a repository** → 이 저장소 선택
2. 빌드 설정: Build command `npm run build`, Deploy command `npx wrangler deploy` (기본값 그대로)
3. 배포가 끝나면 Worker → **Settings → Variables and Secrets** → **Add** → 종류 *Secret*, 이름 `OPENAI_API_KEY`, 값에 키 → 저장(바로 적용)
4. `https://wakppu.<계정>.workers.dev` 로 접속해서 확인. 수량 바꾸기는 `wrangler.jsonc` 의 `vars` 를 고쳐서 올리면 된다.

Durable Object(하루 수량·공유한 볼 저장)와 분당 요청 제한은 따로 만들 것 없이 첫 배포 때 같이 생긴다.

### 보안·운영 메모

- API 는 같은 사이트에서 온 요청(`Origin`)만 받는다. 다른 사이트가 방문자 브라우저를 빌려 수량을 쓰지 못한다.
- 하루 전체 한정 + IP별 하루 한도 + 분당 요청 제한. 실패해서 요금이 안 나간 호출은 수량을 돌려준다 (시간 초과는 이미 만들어졌을 수 있어 돌려주지 않음).
- OpenAI 오류 내용은 사용자에게 보내지 않고 Worker 로그(대시보드 → Observability)에만 남긴다.
- IP 는 저장하지 않고, 날짜마다 바뀌는 해시로만 센다. 공유한 볼은 30일 뒤 지운다.
- OpenAI 프로젝트에 월 예산 한도를 걸어 두는 것을 권장.

### 배포판을 로컬에서 미리 보기

```bash
npm run cf:dev   # 빌드 후 wrangler dev (http://localhost:8787)
```

`wrangler dev` 는 `.env` 의 키를 그대로 읽으므로 실제 OpenAI 호출이 나간다.
