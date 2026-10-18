// 소개 페이지 (intro.html): 앱과 같은 스타일·배경(떠다니는 젤리·코스틱 빛)을 그대로 쓴다
import "./style.css";
import "./intro.css";
import { startBackgroundFx } from "./bgFx";
import { JellyField } from "./jellyField";

startBackgroundFx(document.querySelector<HTMLCanvasElement>("#fx-bg")!);
new JellyField(document.querySelector<HTMLCanvasElement>("#jelly-bg")!);
