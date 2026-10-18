// Vercel 배포 묶음 만들기 (Build Output API v3) — `npm run build` 뒤에 실행한다.
//   .vercel/output/static/                 ← dist/ (화면)
//   .vercel/output/functions/api/*.func/   ← server/vercel.ts 를 한 파일로 묶은 함수 (/api/status · /api/waxify · /api/share)
//   .vercel/output/config.json             ← 보안 헤더·캐시 (public/_headers 를 그대로 옮김)
// Node 만 쓰고 셸 명령(rm·cp)은 쓰지 않아서 Windows·Linux 어디서나 똑같이 돈다.
import fs from "node:fs";
import path from "node:path";
import { build } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, ".vercel", "output");
const dist = path.join(root, "dist");
const ROUTES = ["status", "waxify", "share"];

if (!fs.existsSync(path.join(dist, "index.html"))) {
  console.error("dist/ 가 없어요. 먼저 npm run build 를 실행하세요.");
  process.exit(1);
}
fs.rmSync(out, { recursive: true, force: true });

// 1) 화면: dist → static (_headers 는 Cloudflare 용 설정이라 빼고 config.json 으로 옮긴다)
fs.cpSync(dist, path.join(out, "static"), {
  recursive: true,
  filter: (src) => path.basename(src) !== "_headers",
});

// 2) API 함수: 한 파일(CommonJS)로 묶어서 경로마다 같은 함수를 둔다
const fnDir = path.join(out, "functions", "api");
const first = path.join(fnDir, `${ROUTES[0]}.func`);
await build({
  configFile: false,
  logLevel: "warn",
  publicDir: false, // 화면용 public/ 은 함수에 넣지 않는다
  build: {
    ssr: path.join(root, "server", "vercel.ts"),
    outDir: first,
    emptyOutDir: true,
    target: "node22",
    minify: false,
    rollupOptions: { output: { format: "cjs", entryFileNames: "index.js", exports: "default" } },
  },
  ssr: { target: "node", noExternal: true },
});
const vcConfig = {
  runtime: "nodejs22.x",
  handler: "index.js",
  launcherType: "Nodejs",
  maxDuration: "max", // AI 변환이 10~60초 걸려서 요금제 최대치까지
};
fs.writeFileSync(path.join(first, ".vc-config.json"), JSON.stringify(vcConfig, null, 2));
// 프로젝트가 "type": "module" 이라도 함수 파일은 CommonJS 로 읽히게
fs.writeFileSync(path.join(first, "package.json"), JSON.stringify({ type: "commonjs" }));
for (const name of ROUTES.slice(1)) fs.cpSync(first, path.join(fnDir, `${name}.func`), { recursive: true });

// 3) 헤더: public/_headers 의 규칙을 Vercel 경로 규칙으로
const routes = [];
let current = null;
for (const line of fs.readFileSync(path.join(root, "public", "_headers"), "utf8").split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith("#")) continue;
  if (!/^\s/.test(line)) {
    const src = "^" + line.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$";
    current = { src, headers: {}, continue: true };
    routes.push(current);
  } else if (current) {
    const i = line.indexOf(":");
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
}
fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({ version: 3, routes }, null, 2));

const files = (dir) =>
  fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()).length;
console.log(
  `Vercel 묶음 완성: static ${files(path.join(out, "static"))}개 파일, 함수 ${ROUTES.map((r) => `/api/${r}`).join(" ")}, 헤더 규칙 ${routes.length}개`,
);
