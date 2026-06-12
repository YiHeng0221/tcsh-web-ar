# Mode A 核心 AR — 實作說明書（A3 QR+solvePnP / A4 AR Viewing）

> **讀者：** 實作 agent（opus）。
> **作者：** fable（主迴圈）。
> **裁決順序：** 本 spec > `CLAUDE.md` > 既有程式碼風格。衝突時停下標註，不要自行裁決。
> **對應 issues：** #13（A3 QR + solvePnP）、#14（A4 AR viewing）、#17（IMU tracking）。
> **前置：** `feature/sqlite-migration` 已合進 main（API surface 以本文為準）。

---

## 0. 一句話目標

使用者站在觀賞站掃地面 QR → 解出 6DoF 相機 pose → 相機畫面上以世界鎖定
（world-locked）方式渲染該站可見的 placements；QR 不在畫面時用 IMU 維持
旋轉追蹤。精度目標：使用者站定時 **公分級**。

## 0.5 全程使用流程（2026-06-13 使用者拍板，二次修訂）

```
作品前方地面 QR（QR = URL）── 手機原生相機掃
  → 深連結「直接」進 Mode A 的 AR 畫面（不經 landing / 不選 mode）
  → 首次造訪：一顆「開始 AR」大按鈕（iOS 規定相機 + motion 權限必須
    由使用者手勢觸發——這一次點擊不可省，也只需要這一次）
  → 相機畫面開啟，取景框提示「對準地面的 QR」
  → 對準同一張 QR ~1 秒 → solvePnP 鎖定 → AR 貼圖淡入（同畫面狀態
    轉換，不換頁）
  → 畫面右上角：mode 切換 switch（A ↔ B；C 不在公開 UI）
  → 定位跑掉 → 取景提示重現 → 對準附近任一張 QR 自動 re-snap
    （不同站 QR = 換錨，placements 換站重取）
```

設計後果：
- **A3 與 A4 合併成單一 `ARView` 畫面**，內部狀態機：
  `permission-gate → scanning → viewing → coasting(→ rescan prompt)`。
  不是兩條路由——掃描框與 AR 內容在同一個相機 surface 上切換。
- 路由：`/a/scan/{station_id}` 與 `/a/view/{station_id}` 都導到 ARView
  （保留兩個 path 是為了已印出的 QR 與舊連結不失效）。
- **A2 站點選擇器退出主流程**（站點由掃到的 QR 決定），保留作為
  「沒掃 QR 直接進網站」的 fallback。
- ARView 的連續掃描接受**任何**站的 QR（不只當前站）——換站即換錨。
- 右上 mode switch：A↔B 切換（B = 3D viewer）。切到 B 要釋放相機。

## 1. Scope / Non-goals

**做：**
- `lib/ar/` 追蹤管線：QR 偵測、solvePnP pose、IMU 旋轉融合
- A3 畫面：掃描 UI（取景框、偵測回饋、成功轉場）
- A4 畫面：fullbleed 相機 + R3F 世界鎖定渲染 + 重新校準提示
- 單元測試：pose 數學、座標轉換、融合邏輯（不需要 e2e 相機測試）

**不做（明確排除）：**
- MindAR / 影像追蹤輔助（v2 再議）
- 加速度計位移積分（spec 禁用——使用者假設站定）
- A5 物件抽屜 / A6 下一站導引（#15/#16，另開 PR）
- 離線快取策略

## 2. 架構總覽

```
camera (getUserMedia 1280×720 environment)
  │ video frames
  ├─► zxing-js BrowserQRCodeReader（持續掃描，~10fps throttle）
  │     │ QR text + 4 corner points (px)
  │     ▼
  │   solvePnP (OpenCV.js, lazy-loaded WASM)
  │     │ rvec/tvec → camera pose in anchor frame（QR 中心 = 原點）
  │     ▼
  ├─► PoseFusion ──────────► three.js camera matrix（每幀）
  │     ▲ rotation delta
  └── DeviceOrientationEvent（IMU，~60Hz）
```

**核心原則：QR 可見時 QR 是 ground truth（snap），不可見時 IMU 只接管
「旋轉」，位置凍結在最後一次 QR solve 的值。**

## 3. 新依賴（apps/web/package.json）

| 套件 | 用途 | 載入策略 |
|------|------|---------|
| `@zxing/browser` + `@zxing/library` | QR 偵測 + corner points | A3 chunk（lazy route 已 code-split） |
| `@techstark/opencv-js` | solvePnP | **動態 `import()` on A3 mount**，絕不進主 bundle。WASM ~8MB，載入中顯示 spinner（A3 有「準備相機」狀態可複用） |

不要自己手刻 PnP。不要引入其他 CV 庫。

## 4. 檔案配置（全部新檔，除了兩個 stub 替換）

```
apps/web/src/lib/ar/
  permissions.ts        # 已存在，不動
  camera.ts             # getUserMedia wrapper：開流、選軌、釋放
  qr-detector.ts        # zxing 包裝：start/stop、corner 抽取、station payload 解析
  opencv-loader.ts      # 動態載入 + cv ready promise（單例）
  solve-pnp.ts          # 核心數學：corners px + size_mm → pose
  imu.ts                # DeviceOrientationEvent → three quaternion（含 iOS 權限）
  pose-fusion.ts        # QR snap + IMU delta 融合；外部唯一 pose 來源
  coords.ts             # 座標系轉換常數 + 工具（見 §5，最容易錯的地方）
apps/web/src/modes/a/screens/
  A3QRScan.tsx          # 取代 stub
  A4ARViewing.tsx       # 取代 stub
apps/web/src/modes/a/components/
  ScanReticle.tsx       # 取景框 + 偵測狀態動畫
  RecalibrateToast.tsx  # 「請對準地面的 QR 重新校準」提示
apps/web/src/lib/ar/__tests__/
  solve-pnp.test.ts     # 已知 corner → 已知 pose 的合成案例
  pose-fusion.test.ts   # snap/freeze/delta 規則
  coords.test.ts        # 轉換 round-trip
```

## 5. 座標系（先讀三遍再寫程式碼）

**Anchor frame（世界）：** QR 中心為原點，QR 平面 = 地面 = XZ 平面，
+Y 朝上（重力反方向），+X 朝 QR 的「右」（QR 自身定向），右手系。

**QR 實體尺寸：** `AnchorOut.size_mm`（API 回傳，目前 seed 是 200mm）。
QR 四角在 anchor frame 的 objectPoints（單位 **公尺**，OpenCV 慣例配合
three.js 用公尺）：

```ts
const s = size_mm / 1000 / 2;
// zxing corner 順序：topLeft, topRight, bottomRight, bottomLeft（QR 自身定向）
// 地面 QR：topLeft = (-s, 0, -s), topRight = (s, 0, -s),
//          bottomRight = (s, 0, s), bottomLeft = (-s, 0, s)
```

**OpenCV → three.js 轉換：** OpenCV 相機系 +Y 下 / +Z 前，three.js +Y 上 /
+Z 後。`solvePnP` 回傳的 rvec/tvec 是 **object→camera**；要的是
camera-in-world：`R_wc = R^T`, `t_wc = -R^T·t`，再左乘 `diag(1,-1,-1)` 軸翻轉。
把這段寫在 `coords.ts`，配 round-trip 測試鎖住（合成一個已知 pose →
project corners → solvePnP → 應還原原 pose，容差 <1e-3）。

**intrinsics：** 沒有標定資料。用近似：`fx = fy = w * 0.9`（經驗值，
對 iPhone 廣角在 1280×720 誤差可接受）、`cx = w/2`、`cy = h/2`、畸變設 0。
在 `coords.ts` 留 `// TODO(field-test): replace with calibrated intrinsics`。
**solvePnP flag 用 `SOLVEPNP_IPPE_SQUARE`**（平面正方形專用，就是為這場景
設計的，比 ITERATIVE 穩）。

## 6. 模組規格

### camera.ts
```ts
export async function openArCamera(): Promise<MediaStream>
// video: { facingMode: { exact: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } }
// exact 失敗 fallback ideal。回傳前不 attach；呼叫端負責 videoEl.srcObject。
export function closeArCamera(stream: MediaStream): void  // 停所有 track
```

### qr-detector.ts
- 包 `BrowserQRCodeReader.decodeFromVideoElement`，但用 **手動 frame loop**
  （`requestVideoFrameCallback`，fallback rAF）+ 100ms throttle，不用 zxing
  內建連續模式（無法控制頻率）。
- QR payload 格式（**2026-06-13 更新：URL 制，雙格式相容**）：
  - **主格式：URL** `https://<host>/a/scan/{station_id}`——同一張 QR 兼任
    「入口」與「錨點」：訪客用**手機原生相機**掃它開啟網頁（深連結帶站點），
    進到 Mode A 後 app 內相機再對準同一張 QR 做 solvePnP 定位。host 不限
    （LAN IP / 正式網域都行），只認 path pattern `/a/scan/{id}`。
  - **相容格式：** `tcsh://station/{station_id}`（早期 demo 資產用）。
  - 解析失敗（別人的 QR）→ 回 `{ kind: "foreign" }`，UI 顯示「這不是本展的 QR」。
- **corner 來源**：zxing `ResultPoint[]`。注意 zxing 的 resultPoints 是
  3 個 finder pattern + 1 個 alignment pattern，**不是**四個外角。用
  finder pattern 幾何外推外角（finder 中心離角 3.5 module，QR version 由
  zxing result 取得 module 數）→ 這段數學寫進 `coords.ts` 並測試。
- `dispose()` 必須呼叫 reader reset + 取消 frame loop（REVIEW.md 紅線）。

### opencv-loader.ts
```ts
export function loadOpenCv(): Promise<typeof cv>  // 單例 promise，重複呼叫共用
```
`@techstark/opencv-js` 的 default export 是 init promise。**所有 cv.Mat 用後
立即 `.delete()`**——WASM heap 不歸 GC 管，漏一個就是洩漏（review 會抓）。

### solve-pnp.ts
```ts
export type PnpResult = { position: Vector3; quaternion: Quaternion; reprojErrorPx: number };
export function solveQrPose(cornersPx: Point2[], sizeMm: number, videoW: number, videoH: number): PnpResult | null
```
- reprojection error > **8px** → 回 null（品質門檻，防爛 pose snap 進去）。
- 純函式、不持狀態，方便測試。

### imu.ts
- `deviceorientation` event → three `Quaternion`（注意 iOS 的
  `webkitCompassHeading` 不用；用相對模式即可——absolute 不可靠且不需要，
  因為 QR snap 會定期歸正）。
- screen orientation 補償（portrait lock 假設，但要處理 `orientationchange`
  時直接 re-prompt 重掃，不要嘗試補償 landscape——UX 簡化決策，記進 PR body）。
- iOS 權限：**沿用 `permissions.ts` 既有 pattern**，不要重新實作。

### pose-fusion.ts（追蹤策略的心臟）
狀態機三態：
```
acquiring   # 還沒有任何有效 QR pose
tracking    # QR 最近 2s 內 solve 成功過
coasting    # QR 丟失 >2s，IMU-only 旋轉，位置凍結
```
規則：
1. QR solve 成功（reproj OK）→ position/orientation **直接 snap**（不濾波
   ——濾波延遲在站定場景比抖動更傷）。記 `lastQrAt`、記當下 IMU 四元數為
   `imuRefQuat`、QR pose 四元數為 `poseRefQuat`。
2. 每幀輸出：`tracking` 態且本幀無 QR → `pose = poseRefQuat · (imuRefQuat⁻¹ · imuNow)`
   （IMU delta 疊在最後 QR 定向上），position 不變。
3. `coasting` >10s → 升 `RecalibrateToast`（「請對準地面的 QR 重新校準」）。
4. 抖動防護：連續 3 幀 reproj error 跳 >2× 中位數 → 丟棄該幀（遮擋瞬間的
   爛解）。

### A3QRScan.tsx
- mount：開相機（permissions 已在 A1 拿過；被拒 → 導回 `/a/permission`）
  → 並行 `loadOpenCv()`，雙 ready 才開始掃。
- UI 狀態：`preparing`（相機/OpenCV 載入）→ `scanning`（取景框呼吸動畫）→
  `locked`（偵測到本展 QR + pose OK：取景框變綠 + haptic `navigator.vibrate(50)`）
  → 800ms 後 `navigate(\`/a/view/${stationId}\`)`。
- **掃到的 stationId 與 URL param 不符** → 不是錯誤！顯示「你在 {label} 站」
  並導去正確站的 A4（使用者走錯站很正常）。
- unmount cleanup：相機流、QR reader、frame loop 全關（REVIEW.md 紅線）。
- **pose 傳遞**：navigate 時把初始 pose 放進 router `state`（不能放 URL）；
  A4 mount 時也可重新取得（QR 還在畫面內），所以 state 遺失不是致命錯。

### A4ARViewing.tsx
- 結構：`<video>` fullbleed（absolute, object-cover）+ R3F `<Canvas>` 疊上
  （透明背景 `gl={{ alpha: true }}`）。**不用 WebXR**（iOS Safari 不支援，
  整個架構就是為此設計的）。
- R3F 相機：每幀從 `pose-fusion` 讀 pose 寫進 camera（`useFrame`，
  `camera.matrixAutoUpdate = false`）。FOV 要跟 intrinsics 一致：
  `fov = 2·atan(h/(2·fy))`（coords.ts 提供換算）。
- 內容：fetch `/placements?anchor_id={stationId}`（TanStack Query）→ 每個
  placement 渲一個 quad（`Transform`: position/quat/scale 直接餵 three）貼
  `/textures/{texture_id}/file` 的貼圖。**懶載入 + LRU**：視錐內才載貼圖，
  cache 上限 50 張（CLAUDE.md 性能規則：絕不能眼睛一閉全載 300 張）。
- A3 的 QR 偵測 loop 在 A4 **繼續跑**（降頻到 2fps）——這就是「QR 可見就
  re-solve snap 漂移歸零」的recalibration 機制。
- `RecalibrateToast` 接 pose-fusion 的 coasting 訊號。
- unmount：dispose 所有 geometry/material/texture（REVIEW.md 紅線），
  相機流關閉，QR loop 停。

## 7. 驗收標準（PR body 要逐條勾）

- [ ] `bun run typecheck && bun run build` 綠
- [ ] `bun run test`：solve-pnp / pose-fusion / coords 測試全過
- [ ] 主 bundle 體積不變（opencv 確認在獨立 chunk：`bun run build` 後看
      `dist/assets` 清單，PR body 附 chunk 列表）
- [ ] A3 → A4 流程在桌機瀏覽器可走通（DevTools sensor 模擬 OK；真機
      iOS 田測是合併後的事，不阻擋 PR）
- [ ] 所有 `cv.Mat` 路徑有對應 `.delete()`（自查 + review 會抓）
- [ ] 無新 env var；無 placement 邏輯進 client（只渲染不決策）

## 8. PR 切法（兩個 PR，按序）

1. **PR-1 `feat(web): Mode A AR tracking pipeline (lib/ar)`** —
   camera / qr-detector / opencv-loader / solve-pnp / imu / pose-fusion /
   coords + 全部測試。純 lib，不動畫面。≤800 LoC（不含測試可拆計算，
   超了就把 imu+fusion 拆成 PR-1b）。
2. **PR-2 `feat(web): Mode A · A3 QR scan + A4 AR viewing screens`** —
   兩個畫面 + 元件，接 PR-1 的 lib。

每個 PR 開在 `YiHeng0221/tcsh-web-ar`，harness 會自動 review；findings 由
fable 處理，agent 不回應 review。

## 9. 已知風險（agent 不用解，標註即可）

- intrinsics 近似值的實際誤差 → 田測校正（§5 TODO 已標）。
- zxing finder-pattern 外推外角在 QR 傾斜視角下的精度 → 若測試顯示
  reproj error 系統性偏高，PR body 註記，考慮改用 `jsQR`（回傳真四角）
  ——**先不要換**，先量。
- iOS `requestVideoFrameCallback` 在低電量模式的節流 → 接受（掃描變慢
  但不壞）。
