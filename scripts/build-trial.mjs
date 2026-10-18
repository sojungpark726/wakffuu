// 체험판 빌드 결과(dist-trial)를 claude.ai 아티팩트 한 장짜리 페이지로 묶는다.
// 아티팩트 규칙: <html>/<head>/<body> 없이 내용만, 맨 위에 <title>, 외부 스타일은 Google Fonts 만,
// 나머지 CSS·JS 는 페이지 안에 직접 넣는다.
import fs from "node:fs";
import path from "node:path";

const dir = "dist-trial";
const html = fs.readFileSync(path.join(dir, "index.html"), "utf8");

const cssFile = html.match(/<link[^>]*rel="stylesheet"[^>]*href="\.?\/?(assets\/[^"]+\.css)"[^>]*>/)?.[1];
const jsFile = html.match(/<script[^>]*type="module"[^>]*src="\.?\/?(assets\/[^"]+\.js)"[^>]*><\/script>/)?.[1];
if (!cssFile || !jsFile) throw new Error("빌드 결과에서 CSS/JS 를 찾지 못함");
const css = fs.readFileSync(path.join(dir, cssFile), "utf8");
const js = fs.readFileSync(path.join(dir, jsFile), "utf8").replace(/<\/script/gi, "<\\/script");

const body = html
  .match(/<body>([\s\S]*?)<\/body>/)[1]
  .replace(/<script[^>]*type="module"[^>]*><\/script>/g, "")
  .trim();

const page = `<title>왁뿌 시뮬레이터</title>
<meta name="claude:viewport-fit-sides" content="cover">
<meta name="description" content="준비된 젤리 왁뿌볼을 금 가게 하고, 꾹 으깨고, 던지고, 안의 슬라임까지 만지는 체험판">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@500;600;700;800;900&family=Orbitron:wght@700;800;900&display=swap">
<style>
${css}
</style>
${body}
<script type="module">
${js}
</script>
`;

const out = path.join(dir, "wakppu-trial.html");
fs.writeFileSync(out, page);
console.log(`${out} (${(page.length / 1024).toFixed(0)} KB)`);
