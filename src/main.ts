import "./style.css";
import { ApiError, describeError, fetchSharedBall, getStatus, shareBall, SOLD_OUT_MESSAGE, waxify, type ApiStatus } from "./api";
import { normalizeAiBall, SHELL_SIZE } from "./ballRender";
import { startBackgroundFx } from "./bgFx";
import { designBall, type BallDesign } from "./design";
import { alphaBBox, canvasToBlob, ctx2d, downloadBlob, fileToCanvas, fitSquare, loadImage, makeCanvas } from "./imageUtil";
import { JellyField } from "./jellyField";
import { cutout, preloadSegmenter } from "./segment";
import { deleteBall, getBall, listBalls, MAX_BALLS, newId, persistent, putBall, type BallSource, type SavedBall } from "./store";
import { TRIAL, TRIAL_BALLS, trialShell, useCapability } from "./trial";
import { FILLING_LABEL, FILLING_ORDER, RARITY_CHANCE, WaxBall, type FillingType, type Rarity } from "./waxBall";

const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) =>
  root.querySelector(sel) as T;

// 개발 중 희귀 연출 확인용: 주소 뒤에 ?rare 면 무조건 무지개, ?diamond 면 무조건 다이아몬드
const params = new URLSearchParams(location.search);
const FORCE_RARITY: Rarity | null = !import.meta.env.DEV
  ? null
  : params.has("diamond")
    ? "diamond"
    : params.has("rare")
      ? "rainbow"
      : null;
const pct = (p: number) => Math.round(p * 100);

const CRUNCH_LABEL = { soft: "보들", crispy: "바삭", hard: "단단" } as const;
/** 보관함 칸에 붙는 표시 (친구에게 받은 볼만) */
const SOURCE_TAG: Partial<Record<BallSource, string>> = { shared: "공유" };

const SAMPLES: Record<string, { emoji: string; subject: string; bg: [string, string] }> = {
  apple: { emoji: "🍏", subject: "청사과", bg: ["#ffe3ec", "#f5c6d6"] },
  strawberry: { emoji: "🍓", subject: "딸기", bg: ["#fff2c9", "#f5dd99"] },
  donut: { emoji: "🍩", subject: "도넛", bg: ["#d9f0ff", "#b8dcf5"] },
  cat: { emoji: "🐱", subject: "고양이", bg: ["#e8f5d6", "#cfe6b5"] },
};

/** 지금 놀이판에 올라간 왁뿌볼 */
interface Current {
  shell: HTMLCanvasElement;
  design: BallDesign;
  source: BallSource;
  savedId: string | null;
  sharedId: string | null;
}

let status: ApiStatus = { openai: false, limit: 0, remaining: 0 };
let current: Current | null = null;
let photo: HTMLCanvasElement | null = null;
let sampleKey: string | null = null;
let runId = 0;
/** 보관·공유가 진행 중이면 버튼을 잠가서 두 번 눌러도 한 번만 */
let saving = false;
let sharing = false;

// ---------- 놀이판 ----------

class PlayView {
  readonly ball: WaxBall;
  private overlay = $("#play .overlay");
  private status = $("#play .status");
  private retry = $<HTMLButtonElement>("#play .retry");
  private hint = $("#play .hint");
  private buttons: Record<string, HTMLButtonElement> = {};

  constructor(readonly el: HTMLElement) {
    this.ball = new WaxBall($("canvas", el) as HTMLCanvasElement);
    this.ball.forceRarity = FORCE_RARITY;
    el.querySelectorAll<HTMLButtonElement>("[data-act]").forEach((b) => (this.buttons[b.dataset.act!] = b));
    this.ball.onChange = () => this.sync();
    $("canvas", el).addEventListener("pointerdown", () => this.hint.classList.add("used"));

    this.buttons.reset.onclick = () => this.ball.reset();
    this.buttons.filling.onclick = () => {
      // 무지개·다이아몬드는 희귀볼을 깨서 찾았을 때만 고를 수 있다
      const found = this.ball.found;
      const order: FillingType[] = found === "normal" ? FILLING_ORDER : [found, ...FILLING_ORDER];
      const i = order.indexOf(this.ball.shownFilling);
      this.ball.setFilling(order[(i + 1) % order.length]);
    };
    this.buttons.slowmo.onclick = () => this.ball.replaySlowmo();
    this.buttons.video.onclick = () => void saveVideo(this.ball.video);
    this.buttons.save.onclick = () => void saveCurrent();
    this.buttons.share.onclick = () => void shareCurrent();
    this.sync();
  }

  loading(text: string) {
    this.ball.clear();
    this.overlay.className = "overlay";
    this.status.textContent = text;
    this.retry.hidden = true;
  }

  /** 만들지 못했을 때: 안내 + (가능하면) 다시 시도 */
  error(text: string, retry?: () => void) {
    this.overlay.className = "overlay error";
    this.status.textContent = text;
    this.retry.hidden = !retry;
    this.retry.onclick = retry ?? null;
  }

  setStatus(text: string) {
    this.status.textContent = text;
  }

  /** 왁뿌볼을 놀이판에 올린다 */
  show(cur: Current, title: string) {
    this.overlay.className = "overlay off";
    $("#play-kind").textContent = title;
    this.hint.classList.remove("used");
    const d = cur.design;
    this.ball.setShell(cur.shell, { fillingType: d.fillingType, fillingColor: d.fillingColor, crunch: d.crunch });
  }

  sync() {
    const { ball, buttons } = this;
    const live = ball.state !== "empty";
    buttons.reset.disabled = !live;
    buttons.filling.disabled = !live;
    buttons.filling.textContent = `속: ${FILLING_LABEL[ball.shownFilling]}`;
    buttons.slowmo.disabled = !ball.canReplay;
    buttons.video.disabled = !ball.video;
    buttons.share.disabled = !live || sharing;
    buttons.save.disabled = !live || !!current?.savedId || saving;
    buttons.save.textContent = current?.savedId ? "보관됨 ✓" : "보관하기";
    this.el.classList.toggle("rare-found", ball.found === "rainbow");
    this.el.classList.toggle("diamond-found", ball.found === "diamond");
  }
}

const play = new PlayView($("#play"));

const steps = {
  upload: $("#step-upload"),
  trial: $("#step-trial"),
  pick: $("#step-pick"),
  arena: $("#step-arena"),
};
/** 첫 화면: 정식 앱은 사진 올리기, 체험판은 준비된 왁뿌볼 고르기 */
const HOME: keyof typeof steps = TRIAL ? "trial" : "upload";
function show(step: keyof typeof steps, scroll = true) {
  for (const [k, el] of Object.entries(steps)) el.hidden = k !== step;
  // 젤리처럼 통 튀어나오는 등장
  const el = step === "arena" ? $("#play") : steps[step];
  el.classList.remove("enter");
  void el.offsetWidth;
  el.classList.add("enter");
  if (scroll) steps[step].scrollIntoView({ behavior: "smooth", block: "start" });
}

// ---------- 시작 ----------

async function init() {
  $("#lucky").textContent = `🌈 ${pct(RARITY_CHANCE.rainbow)}% 무지개 글리터 · 💎 ${pct(RARITY_CHANCE.diamond)}% 다이아몬드 슬라임이 숨어 있어요`;
  void renderInventory();
  if (TRIAL) {
    // 체험판: 서버가 없으니 만들기·공유·한정 수량 대신 준비된 왁뿌볼
    $("#again").textContent = "다른 왁뿌볼 고르기";
    play.el.querySelector<HTMLElement>("[data-act=\"share\"]")!.hidden = true;
    show("trial", false);
    renderTrial();
    return;
  }
  status = await getStatus();
  renderQuota();
  play.sync();
  const shared = params.get("ball");
  if (shared) void receiveShared(shared);
}

/** 체험판: 준비된 왁뿌볼 9종 (썸네일은 하나씩 나눠 그려서 첫 화면이 멈추지 않게) */
function renderTrial() {
  const grid = $("#trial-grid");
  const queue: (() => void)[] = [];
  for (const t of TRIAL_BALLS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "trial-item";
    const thumbCanvas = document.createElement("canvas");
    thumbCanvas.width = thumbCanvas.height = 180;
    const label = document.createElement("span");
    label.textContent = `${t.design.emoji} ${t.design.name}`;
    btn.append(thumbCanvas, label);
    btn.onclick = () => playTrial(t);
    grid.append(btn);
    queue.push(() => ctx2d(thumbCanvas).drawImage(trialShell(t.kind, 180), 0, 0));
  }
  const next = () => {
    queue.shift()?.();
    if (queue.length) setTimeout(next, 30);
  };
  setTimeout(next, 200);
}

function playTrial(t: (typeof TRIAL_BALLS)[number]) {
  runId++;
  current = { shell: trialShell(t.kind), design: { ...t.design }, source: "basic", savedId: null, sharedId: null };
  show("arena");
  setTitle(current.design);
  play.show(current, "체험 왁뿌볼");
  void renderInventory();
}

/** 깨는 영상 저장: 아티팩트에서는 뷰어의 저장 확인창을 거친다 */
async function saveVideo(v: WaxBall["video"]) {
  if (!v) return;
  const filename = `wakppu.${v.ext}`;
  if (!TRIAL) return downloadBlob(v.blob, filename);
  const downloads = await useCapability<{ save(r: { filename: string; data: Blob }): Promise<unknown> }>("downloads");
  if (!downloads) return toast("이 화면에서는 영상을 저장할 수 없어요");
  try {
    await downloads.save({ filename, data: v.blob });
    toast("영상을 저장했어요");
  } catch (e) {
    if ((e as { code?: string }).code !== "declined") toast("영상을 저장하지 못했어요");
  }
}

/** AI 변환 하루 한정 수량 표시 (키가 있을 때만) */
function renderQuota() {
  // 서버 값은 숫자로만 쓰고 글자로 넣는다 (HTML 로 끼워 넣지 않음)
  const left = Math.max(0, Number(status.remaining) || 0);
  const limit = Math.max(0, Number(status.limit) || 0);
  document.querySelectorAll<HTMLElement>(".quota").forEach((el) => {
    el.hidden = !status.openai;
    el.classList.toggle("empty", left === 0);
    if (left > 0) {
      const b = document.createElement("b");
      b.textContent = String(left);
      el.replaceChildren("오늘 한정 왁뿌볼 ", b, ` / ${limit}개 남음`);
    } else {
      el.textContent = `오늘 한정 왁뿌볼 ${limit}개 소진 · 내일 0시에 다시 열려요`;
    }
  });
}

async function refreshQuota() {
  status = await getStatus();
  renderQuota();
  play.sync();
}

// ---------- 1. 사진 ----------

const fileInput = $<HTMLInputElement>("#file");
fileInput.onchange = () => {
  const f = fileInput.files?.[0];
  fileInput.value = "";
  if (f) void openPhoto(f);
};

/** 고르거나 붙여넣은 사진 파일을 열어 고르기 화면으로 — 못 여는 사진(HEIC·깨진 파일)이면 안내 */
async function openPhoto(file: File) {
  const id = ++runId;
  let c: HTMLCanvasElement;
  try {
    c = await fileToCanvas(file);
  } catch (e) {
    console.warn("[wakppu] 사진을 열지 못함", e);
    if (id !== runId) return;
    toast("이 사진은 열 수 없어요. 다른 사진으로 해보세요");
    // 만들던 중이었다면 방금 멈췄으니 첫 화면으로
    if (!steps.arena.hidden && play.ball.state === "empty") show(HOME);
    return;
  }
  // 그 사이 다른 사진·볼로 넘어갔으면 늦게 열린 사진은 버린다
  if (id === runId) onPhoto(c, null);
}

const drop = $("#drop");
drop.addEventListener("dragover", (e) => {
  e.preventDefault();
  drop.classList.add("over");
});
drop.addEventListener("dragleave", () => drop.classList.remove("over"));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  drop.classList.remove("over");
  const f = e.dataTransfer?.files[0];
  if (f?.type.startsWith("image/")) void openPhoto(f);
});

// ---------- 붙여넣기 ----------

const PASTE_KEY = /Mac|iPhone|iPad/.test(navigator.userAgent) ? "⌘+V" : "Ctrl+V";
$("#paste-key").textContent = PASTE_KEY;

/** 붙여넣은 사진으로 만들기 (어느 화면에서든) */
async function onPastedImage(blob: Blob) {
  drop.classList.add("over");
  setTimeout(() => drop.classList.remove("over"), 400);
  const file = blob instanceof File ? blob : new File([blob], "pasted", { type: blob.type });
  await openPhoto(file);
}

// 키보드로 붙여넣기 (Ctrl+V / ⌘+V)
document.addEventListener("paste", (e) => {
  if (TRIAL) return; // 체험판은 사진으로 만들기가 없음
  if ((e.target as HTMLElement | null)?.closest?.("input, textarea, [contenteditable]")) return;
  const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === "file" && i.type.startsWith("image/"));
  const file = item?.getAsFile();
  if (!file) {
    if (e.clipboardData?.types.includes("text/plain")) toast("클립보드에 사진이 없어요. 사진을 복사한 뒤 붙여넣어 주세요");
    return;
  }
  e.preventDefault();
  void onPastedImage(file);
});

// 붙여넣기 버튼 (휴대폰처럼 키보드가 없을 때)
$("#paste-btn").onclick = async () => {
  if (!navigator.clipboard?.read) return toast(`${PASTE_KEY} 로 붙여넣어 주세요`);
  try {
    for (const item of await navigator.clipboard.read()) {
      const type = item.types.find((t) => t.startsWith("image/"));
      if (type) return void onPastedImage(await item.getType(type));
    }
    toast("클립보드에 사진이 없어요. 사진을 복사한 뒤 눌러 주세요");
  } catch {
    toast(`붙여넣기를 허용하지 않았어요. ${PASTE_KEY} 로 붙여넣어도 돼요`);
  }
};

document.querySelectorAll<HTMLButtonElement>("[data-sample]").forEach((b) => {
  b.onclick = () => void playSample(b.dataset.sample!);
});

/**
 * 샘플은 AI 로 미리 만들어 둔 왁뿌볼(public/samples)을 바로 꺼낸다 — AI 호출·한정 수량을 쓰지 않는다.
 * 파일을 못 불러오면 예전처럼 샘플 사진으로 직접 만든다.
 */
async function playSample(key: string) {
  const id = ++runId;
  let shell: HTMLCanvasElement;
  try {
    shell = await shellFromUrl(`${import.meta.env.BASE_URL}samples/${key}.webp`);
  } catch (e) {
    console.warn("[wakppu] 미리 만든 샘플을 못 불러와서 직접 만듦", e);
    if (id === runId) onPhoto(sampleCanvas(key), key);
    return;
  }
  if (id !== runId) return;
  const design = designBall(shell, SAMPLES[key]);
  current = { shell, design, source: "ai", savedId: null, sharedId: null };
  show("arena");
  setTitle(design);
  play.show(current, "샘플 왁뿌볼");
}

/** 테스트·체험용 샘플 사진: 이모지를 크게 그린 '사진' */
function sampleCanvas(key: string): HTMLCanvasElement {
  const s = SAMPLES[key];
  const c = makeCanvas(900, 700);
  const g = ctx2d(c);
  const bg = g.createLinearGradient(0, 0, 0, 700);
  bg.addColorStop(0, s.bg[0]);
  bg.addColorStop(1, s.bg[1]);
  g.fillStyle = bg;
  g.fillRect(0, 0, 900, 700);
  g.fillStyle = "rgba(0,0,0,0.08)";
  g.beginPath();
  g.ellipse(450, 560, 210, 34, 0, 0, Math.PI * 2);
  g.fill();
  g.font = `400px "Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",sans-serif`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#5a3a2a"; // 컬러 이모지 폰트가 없는 환경에서 흑백 글리프로 그려질 때의 색
  g.fillText(s.emoji, 450, 350);
  return c;
}

function onPhoto(c: HTMLCanvasElement, sample: string | null) {
  runId++; // 만들던 볼·늦게 열리던 사진은 무시
  photo = c;
  sampleKey = sample;
  void preloadSegmenter().catch(() => {}); // 고르는 동안 모델을 미리 받아둔다
  // 숨겨진 채로 재면 폭이 0 이라 먼저 보여주고 잰다
  show("pick");
  const pc = $<HTMLCanvasElement>("#pick-canvas");
  const cs = getComputedStyle(steps.pick);
  const inner = steps.pick.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const maxW = Math.min(528, inner > 0 ? inner : 528);
  const scale = Math.min(1, maxW / c.width, 520 / c.height);
  const dpr = Math.min(2, devicePixelRatio || 1);
  // 폭만 정하고 높이는 CSS(height:auto)가 비율대로 — 화면이 좁아져도 찌그러지지 않는다
  pc.style.width = `${c.width * scale}px`;
  pc.style.height = "";
  pc.width = Math.round(c.width * scale * dpr);
  pc.height = Math.round(c.height * scale * dpr);
  ctx2d(pc).drawImage(c, 0, 0, pc.width, pc.height);
}

// ---------- 2. 대상 고르기 ----------

$("#pick-canvas").addEventListener("click", (e) => {
  const pc = e.currentTarget as HTMLCanvasElement;
  const r = pc.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
  const ripple = $("#ripple");
  ripple.hidden = false;
  ripple.style.left = `${x * 100}%`;
  ripple.style.top = `${y * 100}%`;
  ripple.style.animation = "none";
  void ripple.offsetWidth;
  ripple.style.animation = "";
  setTimeout(() => run({ x, y }), 250);
});
$("#pick-center").onclick = () => run({ x: 0.5, y: 0.5 });
$("#pick-back").onclick = () => show("upload");
$("#again").onclick = () => {
  runId++;
  play.ball.clear();
  current = null;
  show(HOME);
  void renderInventory();
};

// ---------- 3. 만들기 ----------

async function run(point: { x: number; y: number }) {
  if (!photo) return;
  const id = ++runId;
  show("arena");
  setTitle(null);
  play.loading("누끼 따는 중…");

  const cut = await cutout(photo, point);
  if (id !== runId) return;
  const design = designBall(cut.canvas, sampleKey ? SAMPLES[sampleKey] : null);
  setTitle(design);
  await makeBall(id, cut.canvas, design);
}

const MAKING = "왁스로 굳히는 중…\n보통 10~30초 걸려요";

/** 누끼를 AI 가 왁스 젤리로 다시 그려서 왁뿌볼을 만든다 */
async function makeBall(id: number, cut: HTMLCanvasElement, design: BallDesign) {
  const again = () => {
    const next = ++runId;
    play.loading(MAKING);
    void makeBall(next, cut, design);
  };
  if (!status.openai) {
    // 처음 열 때 상태를 못 받아왔을 수도 있으니 한 번 더 물어본다
    await refreshQuota();
    if (id !== runId) return;
  }
  if (!status.openai) {
    console.warn("[wakppu] OPENAI_API_KEY 가 없어서 왁뿌볼을 만들 수 없음");
    return play.error("지금은 왁뿌볼을 만들 수 없어요.\n잠시 후 다시 해주세요.", again);
  }
  if (status.remaining <= 0) return play.error(SOLD_OUT_MESSAGE);
  play.setStatus(MAKING);
  try {
    const input = fitSquare(cut, 1024, 0.86, "#ffffff", alphaBBox(cut)).toDataURL("image/jpeg", 0.92);
    const res = await waxify(input, design.subject);
    if (id !== runId) return;
    const shell = normalizeAiBall(await loadImage(res.image));
    current = { shell, design, source: "ai", savedId: null, sharedId: null };
    play.show(current, "새로 만든 왁뿌볼");
    void renderInventory();
  } catch (e) {
    console.warn("[wakppu] 왁뿌볼 만들기 실패", e);
    if (id === runId) play.error(describeError(e), again);
  } finally {
    void refreshQuota();
  }
}

function setTitle(design: BallDesign | null) {
  $("#ball-emoji").textContent = design?.emoji ?? "🫧";
  $("#ball-name").textContent = design?.name ?? "굳히는 중…";
  const parts = design ? [design.subject, `껍질 ${CRUNCH_LABEL[design.crunch]}`, `속 ${FILLING_LABEL[design.fillingType]}`] : [];
  $("#ball-sub").textContent = parts.filter(Boolean).join(" · ");
  $(".ball-title").classList.toggle("editable", !!design);
}

// ---------- 이름·아이콘 바꾸기 ----------

const EMOJIS = ["🫧", "🍓", "🍏", "🍑", "🍋", "🍊", "🍇", "🫐", "🍒", "🍩", "🧁", "🍰", "🍬", "🍭", "🧈", "🍮", "🐱", "🐶", "🐰", "🐻", "🐥", "🦄", "🐸", "🐧", "🌈", "⭐", "💖", "💎", "🌸", "🍀", "☁️", "👾"];

$("#ball-title").onclick = () => {
  if (current) editTitle(current);
};

function editTitle(cur: Current) {
  let emoji = cur.design.emoji;
  const form = document.createElement("div");
  form.className = "edit-form";
  form.innerHTML = `
    <span class="ball-emoji edit-preview"></span>
    <input class="name-input" type="text" maxlength="20" placeholder="왁뿌볼 이름" aria-label="왁뿌볼 이름" />
    <div class="emoji-grid" role="listbox" aria-label="아이콘 고르기"></div>
    <input class="emoji-input" type="text" maxlength="8" placeholder="다른 이모지 직접 넣기" aria-label="다른 이모지" />`;
  const preview = $(".edit-preview", form);
  const nameInput = $<HTMLInputElement>(".name-input", form);
  const grid = $(".emoji-grid", form);
  const custom = $<HTMLInputElement>(".emoji-input", form);
  nameInput.value = cur.design.name;
  const pick = (e: string) => {
    emoji = e;
    preview.textContent = e;
    grid.querySelectorAll("button").forEach((b) => b.classList.toggle("selected", b.textContent === e));
  };
  for (const e of EMOJIS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "emoji-btn";
    b.textContent = e;
    b.onclick = () => {
      custom.value = "";
      pick(e);
    };
    grid.append(b);
  }
  custom.addEventListener("input", () => {
    const v = custom.value.trim();
    if (v) pick(v);
  });
  pick(emoji);

  let applied = false;
  const apply = async () => {
    if (applied) return;
    applied = true;
    const name = nameInput.value.trim().slice(0, 20) || cur.design.name;
    cur.design = { ...cur.design, name, emoji };
    cur.sharedId = null; // 이름이 바뀌었으니 공유 링크는 새로 만든다
    closeModal();
    setTitle(cur.design);
    if (cur.savedId) {
      try {
        const saved = await getBall(cur.savedId);
        if (saved) await putBall({ ...saved, design: cur.design });
      } catch (e) {
        console.warn("[wakppu] 보관함 이름 바꾸기 실패", e);
        return toast("이름은 바꿨지만 보관함에는 저장하지 못했어요");
      } finally {
        void renderInventory();
      }
    }
    toast("이름과 아이콘을 바꿨어요");
  };
  nameInput.addEventListener("keydown", (e) => {
    // 한글 조합 중의 Enter 는 글자 확정용이라 무시 (안 그러면 두 번 바뀜)
    if (e.key === "Enter" && !e.isComposing && e.keyCode !== 229) void apply();
  });
  openModal({
    title: "이름·아이콘 바꾸기",
    text: "",
    body: form,
    onCancel: closeModal,
    actions: [
      { label: "취소", cls: "btn ghost", onClick: closeModal },
      { label: "바꾸기", cls: "btn pink", onClick: () => void apply() },
    ],
  });
  setTimeout(() => nameInput.select(), 60);
}

// ---------- 보관함 ----------

const thumbs = new Map<string, string>();
function thumb(b: SavedBall): string {
  let url = thumbs.get(b.id);
  if (!url) {
    url = URL.createObjectURL(b.shell);
    thumbs.set(b.id, url);
  }
  return url;
}

// 좁은 화면에서는 보관함이 오른쪽 끝 서랍: 손잡이를 누르면 열리고, 바깥을 누르면 닫힌다
const inventoryEl = $("#inventory");
const handle = $<HTMLButtonElement>("#inv-handle");
function setDrawer(open: boolean) {
  inventoryEl.classList.toggle("open", open);
  handle.setAttribute("aria-expanded", String(open));
}
handle.onclick = () => setDrawer(!inventoryEl.classList.contains("open"));
document.addEventListener("pointerdown", (e) => {
  const t = e.target as Node;
  // 선택창(지우기 확인 등)을 누를 때는 서랍을 닫지 않는다
  if (inventoryEl.classList.contains("open") && !inventoryEl.contains(t) && !$("#modal").contains(t)) setDrawer(false);
});
// 선택창이 열려 있으면 Esc 는 선택창만 닫는다 (서랍은 그대로)
document.addEventListener("keydown", (e) => e.key === "Escape" && $("#modal").hidden && setDrawer(false));
/** 보관하면 손잡이가 말랑 흔들려서 들어간 걸 알려준다 */
function bumpHandle() {
  handle.classList.remove("bump");
  void handle.offsetWidth;
  handle.classList.add("bump");
}

// 선택 모드: 보관함에서 여러 개를 골라 한 번에 지운다
let selecting = false;
const picked = new Set<string>();

function setSelecting(on: boolean) {
  selecting = on;
  picked.clear();
  inventoryEl.classList.toggle("selecting", on);
  void renderInventory();
}
$("#inv-select").onclick = () => setSelecting(true);
$("#inv-cancel").onclick = () => setSelecting(false);
$("#inv-delete").onclick = () => void deletePicked();

async function deletePicked() {
  const ids = [...picked];
  if (!ids.length) return;
  const ok = await confirmDialog(`왁뿌볼 ${ids.length}개를 지울까요?`, "지운 왁뿌볼은 되돌릴 수 없어요.", "지우기");
  if (!ok) return;
  try {
    for (const id of ids) {
      await deleteBall(id);
      forgetThumb(id);
      // 놀이판에 올라가 있던 볼이면 볼은 그대로 두고 '보관 안 됨' 상태로
      if (current?.savedId === id) current.savedId = null;
    }
    toast(`왁뿌볼 ${ids.length}개를 지웠어요`);
  } catch (e) {
    console.warn("[wakppu] 보관함에서 지우기 실패", e);
    toast("왁뿌볼을 지우지 못했어요. 잠시 후 다시 해주세요");
  }
  setSelecting(false);
  play.sync();
}

function forgetThumb(id: string) {
  const url = thumbs.get(id);
  if (url) URL.revokeObjectURL(url);
  thumbs.delete(id);
}

function confirmDialog(title: string, text: string, okLabel: string): Promise<boolean> {
  return new Promise((resolve) => {
    const cancel = () => (closeModal(), resolve(false));
    openModal({
      title,
      text,
      onCancel: cancel,
      actions: [
        { label: "취소", cls: "btn ghost", onClick: cancel },
        { label: okLabel, cls: "btn coral", onClick: () => (closeModal(), resolve(true)) },
      ],
    });
  });
}

async function renderInventory() {
  const balls = await listBalls();
  $("#inv-count").textContent = $("#inv-handle-count").textContent = `${balls.length}/${MAX_BALLS}`;
  $("#inv-empty").hidden = balls.length > 0;
  if (!balls.length && selecting) {
    selecting = false;
    inventoryEl.classList.remove("selecting");
  }
  $<HTMLButtonElement>("#inv-select").hidden = selecting || !balls.length;
  $("#inv-actions").hidden = !selecting;
  const del = $<HTMLButtonElement>("#inv-delete");
  del.disabled = picked.size === 0;
  del.textContent = picked.size ? `${picked.size}개 삭제` : "삭제";
  const list = $("#inv-list");
  list.innerHTML = "";
  for (const b of balls) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "inv-item";
    btn.classList.toggle("active", !selecting && current?.savedId === b.id);
    btn.classList.toggle("picked", picked.has(b.id));
    btn.setAttribute("aria-pressed", String(selecting && picked.has(b.id)));
    btn.title = selecting ? `${b.design.name} 고르기` : `${b.design.name} 꺼내기`;
    btn.innerHTML = `<img alt="" src="${thumb(b)}" /><span class="inv-name">${escapeHtml(b.design.emoji)} ${escapeHtml(b.design.name)}</span>${SOURCE_TAG[b.source] ? `<span class="inv-tag ${b.source}">${SOURCE_TAG[b.source]}</span>` : ""}`;
    btn.onclick = () => {
      if (!selecting) return void takeOut(b.id);
      if (picked.has(b.id)) picked.delete(b.id);
      else picked.add(b.id);
      void renderInventory();
    };
    li.append(btn);
    list.append(li);
  }
}

async function shellFromUrl(url: string): Promise<HTMLCanvasElement> {
  const img = await loadImage(url);
  const c = makeCanvas(SHELL_SIZE, SHELL_SIZE);
  ctx2d(c).drawImage(img, 0, 0, SHELL_SIZE, SHELL_SIZE);
  return c;
}

/** 보관함에서 꺼내 놀이판에 올리기 */
async function takeOut(id: string) {
  const rid = ++runId;
  let b: SavedBall | undefined;
  let shell: HTMLCanvasElement;
  try {
    b = await getBall(id);
    if (!b || rid !== runId) return;
    shell = await shellFromUrl(thumb(b));
  } catch (e) {
    console.warn("[wakppu] 보관함에서 꺼내기 실패", e);
    if (rid === runId) toast("왁뿌볼을 꺼내지 못했어요");
    return;
  }
  // 그 사이 다른 볼을 꺼냈거나 새로 만들기 시작했으면 늦게 온 결과는 버린다
  if (rid !== runId) return;
  current = { shell, design: b.design, source: b.source, savedId: b.id, sharedId: null };
  show("arena");
  setTitle(b.design);
  play.show(current, "보관함에서 꺼낸 왁뿌볼");
  setDrawer(false);
  void renderInventory();
}

/** 보관하기 — 10개가 꽉 차 있으면 지울 왁뿌볼을 고르는 선택창 */
async function saveCurrent() {
  const cur = current;
  if (!cur || cur.savedId || saving) return;
  saving = true;
  play.sync();
  try {
    const balls = await listBalls();
    if (balls.length >= MAX_BALLS) {
      const victim = await chooseToDelete(balls);
      if (!victim) return;
      await deleteBall(victim);
      forgetThumb(victim);
      if (current?.savedId === victim) current.savedId = null;
    }
    const id = newId();
    await putBall({ id, createdAt: Date.now(), source: cur.source, design: cur.design, shell: await canvasToBlob(cur.shell) });
    cur.savedId = id;
    bumpHandle();
    toast(persistent ? "보관함에 넣었어요" : "보관했어요 (이 브라우저에서는 새로고침하면 사라져요)");
  } catch (e) {
    // 저장 공간이 꽉 찼을 때(QuotaExceeded) 등
    console.warn("[wakppu] 보관 실패", e);
    toast("보관하지 못했어요. 저장 공간이 부족한지 확인해 주세요");
  } finally {
    saving = false;
    await renderInventory();
    play.sync();
  }
}

function chooseToDelete(balls: SavedBall[]): Promise<string | null> {
  return new Promise((resolve) => {
    const cancel = () => (closeModal(), resolve(null));
    let picked: string | null = null;
    const grid = document.createElement("div");
    grid.className = "pick-grid";
    for (const b of balls) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "inv-item";
      btn.innerHTML = `<img alt="" src="${thumb(b)}" /><span class="inv-name">${escapeHtml(b.design.emoji)} ${escapeHtml(b.design.name)}</span>`;
      btn.onclick = () => {
        picked = b.id;
        grid.querySelectorAll(".inv-item").forEach((el) => el.classList.toggle("doomed", el === btn));
        confirm.disabled = false;
      };
      grid.append(btn);
    }
    const confirm = openModal({
      title: `보관함이 꽉 찼어요 (${MAX_BALLS}/${MAX_BALLS})`,
      text: "새 왁뿌볼을 넣으려면 지울 왁뿌볼을 하나 골라주세요.",
      body: grid,
      onCancel: cancel,
      actions: [
        { label: "취소", cls: "btn ghost", onClick: cancel },
        { label: "지우고 보관하기", cls: "btn coral", disabled: true, onClick: () => (closeModal(), resolve(picked)) },
      ],
    })[1];
  });
}

// ---------- 공유 ----------

/** 공유 링크를 만들어 보내기 — 링크를 연 사람은 이 왁뿌볼을 받아서 가지고 놀 수 있다 */
async function shareCurrent() {
  const cur = current;
  if (!cur || sharing) return;
  sharing = true;
  play.sync();
  try {
    // 이미 만든 링크: 누른 그 순간에 바로 공유창·복사
    if (cur.sharedId) return await sendLink(cur, cur.sharedId);
    const design = cur.design;
    let id: string;
    try {
      id = await shareBall(cur.shell.toDataURL("image/png"), design);
    } catch (e) {
      console.warn("[wakppu] 공유 링크 만들기 실패", e);
      return toast(
        e instanceof ApiError && e.code === "rate_limited"
          ? "조금 천천히! 잠시 뒤 다시 공유해 주세요"
          : "공유 링크를 만들지 못했어요. 잠시 후 다시 해주세요",
      );
    }
    if (cur.design === design) cur.sharedId = id; // 올리는 사이 이름을 바꿨으면 다음에 새로 만든다
    // 올리느라 기다린 사이 '누른 순간'이 지나서 (iOS 사파리) 공유창·복사가 막히므로, 링크 창에서 한 번 더 누르게 한다
    if (current === cur) linkDialog(cur, id);
  } finally {
    sharing = false;
    play.sync();
  }
}

function shareInfo(cur: Current, id: string) {
  const url = `${location.origin}${location.pathname}?ball=${encodeURIComponent(id)}`;
  const found = play.ball.found;
  const prefix = found === "diamond" ? "💎 초희귀 다이아몬드 슬라임 당첨! " : found === "rainbow" ? "🌈 희귀 무지개 슬라임 당첨! " : "";
  const title = `${prefix}${cur.design.emoji} ${cur.design.name}`;
  return { url, title, text: `${title} — 받아서 같이 깨보자!` };
}

/** 공유창을 띄우고, 없거나 막히면 링크 복사 (복사도 막히면 링크 창) */
async function sendLink(cur: Current, id: string) {
  const { url, title, text } = shareInfo(cur, id);
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url });
      return;
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    toast("공유 링크를 복사했어요");
  } catch {
    linkDialog(cur, id);
  }
}

/** 만들어진 공유 링크 창 — 버튼을 누르는 순간에 복사·공유해서 iOS 에서도 막히지 않는다 */
function linkDialog(cur: Current, id: string) {
  const { url, title, text } = shareInfo(cur, id);
  const input = document.createElement("input");
  input.type = "text";
  input.readOnly = true;
  input.value = url;
  input.className = "name-input share-link";
  input.setAttribute("aria-label", "공유 링크");
  const selectAll = () => {
    input.focus({ preventScroll: true });
    input.select();
    input.setSelectionRange(0, url.length); // iOS 는 select() 만으로는 안 잡힐 때가 있다
  };
  input.addEventListener("focus", () => input.select());
  input.addEventListener("click", selectAll);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      closeModal();
      toast("공유 링크를 복사했어요");
    } catch {
      selectAll();
      toast("길게 눌러 복사해 주세요");
    }
  };
  const shareNow = async () => {
    try {
      await navigator.share({ title, text, url });
      closeModal();
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") return;
      toast("공유하지 못했어요. 링크를 복사해 주세요");
    }
  };
  const canShare = typeof navigator.share === "function";
  const actions: ModalAction[] = [
    { label: "닫기", cls: "btn ghost", onClick: closeModal },
    { label: "링크 복사", cls: canShare ? "btn lilac" : "btn pink", onClick: () => void copy() },
  ];
  if (canShare) actions.push({ label: "공유하기", cls: "btn pink", onClick: () => void shareNow() });
  openModal({ title: "공유 링크가 만들어졌어요!", text: title, body: input, actions, onCancel: closeModal });
}

/** ?ball=id 로 들어오면: 받은 왁뿌볼을 보여주고 담을지 고르게 */
async function receiveShared(id: string) {
  params.delete("ball");
  const rest = params.toString();
  history.replaceState(null, "", location.pathname + (rest ? `?${rest}` : ""));
  let data: { shell: string; design: BallDesign };
  let shell: HTMLCanvasElement;
  try {
    data = await fetchSharedBall(id);
    shell = await shellFromUrl(data.shell); // 그림이 깨져 있어도 여기서 안내
  } catch {
    return toast("공유된 왁뿌볼을 찾지 못했어요");
  }
  const preview = document.createElement("img");
  preview.className = "shared-preview";
  preview.alt = "";
  preview.src = data.shell;
  const playIt = (keep: boolean) => {
    closeModal();
    runId++;
    current = { shell, design: data.design, source: "shared", savedId: null, sharedId: id };
    show("arena");
    setTitle(data.design);
    play.show(current, "공유받은 왁뿌볼");
    if (keep) void saveCurrent();
  };
  openModal({
    title: "친구가 보낸 왁뿌볼이 도착했어요!",
    text: `${data.design.emoji} ${data.design.name}`,
    body: preview,
    onCancel: () => playIt(false), // 닫아도 받은 볼은 놓치지 않게 '그냥 놀기'로
    actions: [
      { label: "그냥 놀기", cls: "btn ghost", onClick: () => playIt(false) },
      { label: "보관함에 담고 놀기", cls: "btn pink", onClick: () => playIt(true) },
    ],
  });
}

// ---------- 선택창 · 알림 ----------

interface ModalAction {
  label: string;
  cls: string;
  onClick: () => void;
  disabled?: boolean;
}

const appEl = $(".app");
const modalEl = $("#modal");
/** 열린 선택창을 '취소'로 닫을 때 할 일 (Esc · 다른 선택창이 덮을 때) */
let modalCancel: (() => void) | null = null;
/** 선택창이 닫히면 포커스를 돌려줄 곳 */
let modalReturn: HTMLElement | null = null;

function openModal(o: {
  title: string;
  text: string;
  body?: HTMLElement;
  actions: ModalAction[];
  /** Esc 나 다른 선택창에 밀려 닫힐 때 (기다리는 Promise 가 멈추지 않게) */
  onCancel?: () => void;
}): HTMLButtonElement[] {
  if (!modalEl.hidden) {
    // 이미 열린 선택창은 '취소'로 먼저 닫는다. 포커스는 처음 열기 전 자리로 돌려줄 것
    const prev = modalCancel;
    hideModal(false);
    prev?.();
  } else {
    modalReturn = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  $("#modal-title").textContent = o.title;
  $("#modal-text").textContent = o.text;
  $("#modal-text").hidden = !o.text;
  const body = $("#modal-body");
  body.replaceChildren(...(o.body ? [o.body] : []));
  const buttons = o.actions.map((a) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = a.cls;
    b.textContent = a.label;
    b.disabled = !!a.disabled;
    b.onclick = a.onClick;
    return b;
  });
  $("#modal-actions").replaceChildren(...buttons);
  const modal = modalEl;
  modal.hidden = false;
  modalCancel = o.onCancel ?? null;
  // 선택창이 열린 동안 뒤쪽 화면은 누르거나 포커스가 가지 않게
  appEl.toggleAttribute("inert", true);
  modal.querySelector(".modal-card")?.classList.remove("enter");
  void modal.offsetWidth;
  modal.querySelector(".modal-card")?.classList.add("enter");
  const first = body.querySelector<HTMLElement>("input") ?? buttons.find((b) => !b.disabled);
  first?.focus({ preventScroll: true });
  return buttons;
}

function hideModal(restoreFocus: boolean) {
  if (modalEl.hidden) return;
  modalEl.hidden = true;
  modalCancel = null;
  appEl.toggleAttribute("inert", false);
  if (!restoreFocus) return;
  const back = modalReturn;
  modalReturn = null;
  if (back?.isConnected) back.focus({ preventScroll: true });
}

function closeModal() {
  hideModal(true);
}

/** Esc: 취소로 닫기 */
function cancelModal() {
  const cancel = modalCancel;
  hideModal(true);
  cancel?.();
}

// Esc 로 취소, Tab 은 선택창 안에서만 돈다
document.addEventListener("keydown", (e) => {
  if (modalEl.hidden) return;
  if (e.key === "Escape" && !e.isComposing) {
    e.preventDefault();
    cancelModal();
    return;
  }
  if (e.key !== "Tab") return;
  const items = [...modalEl.querySelectorAll<HTMLElement>("button, input, [tabindex]:not([tabindex='-1'])")].filter(
    (el) => !(el as HTMLButtonElement).disabled && el.getClientRects().length > 0,
  );
  if (!items.length) return;
  const first = items[0], last = items[items.length - 1];
  const active = document.activeElement;
  if (!modalEl.contains(active) || (e.shiftKey && active === first) || (!e.shiftKey && active === last)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  }
});

let toastTimer = 0;
function toast(text: string) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  el.classList.remove("show");
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 2600);
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}


startBackgroundFx($<HTMLCanvasElement>("#fx-bg"));
new JellyField($<HTMLCanvasElement>("#jelly-bg"));
void init();
