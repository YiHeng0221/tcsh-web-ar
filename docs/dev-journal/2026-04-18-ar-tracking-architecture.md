# 2026-04-18 — AR 追蹤架構：Station-Based AR

**目標：** 鎖定 Mode A 的追蹤方案。前一天的 project report 裡列了三條
路線（A 商業 SLAM、B MindAR 整件作為 image target、C 改成數位導覽），
今天從策展方拿到的現場資訊讓我們可以選一條更務實、且**不在 A/B/C 之外
的第四條路**——用 QR 定位站（Station-Based AR）。

本篇把這個決策的**為什麼**、**怎麼做**、以及**下次該實作什麼**寫下來，
方便之後回頭看時不用重推一次。

---

## 新拿到的現場資訊

1. **場地周圍可以放 QR code**（地面、告示牌、支架等）——只要**不放在
   作品本體上**。
2. 作品形狀：**兩公尺高、螺旋向內、金屬網格製品**。觀眾走進螺旋內部
   觀賞。從照片看，整件作品的格柵有豐富的視覺特徵（不同密度的矩形
   格子、白色方形面板），雖然是「單色」但**不是**視覺平坦的單色面。
3. 需要的對位精度：**公分級**（貼圖需要精準貼合金屬網格上的矩形面板）。

---

## 為什麼前一天列的三條路線不是最佳答案

- **路線 A（8th Wall）** 技術風險最低，但年費 USD 3–5K 起——有更便宜
  的做法就先試。
- **路線 B（MindAR 以整件作品為 target）** 戶外光線 + 觀眾走入後視角
  變化巨大，辨識率堪憂；而且 MindAR 的輸出是「貼圖相對於 target 圖的
  2D 平面變換」，要做到**公分級 3D 對位 200–300 個物件**很勉強。
- **路線 C（改成數位導覽）** 放棄了沉浸式 AR，和策展方想要的「貼圖疊
  在實體作品上」差距大。

現在有新資訊：**可以放 QR 在地上**。這讓我們有了一個幾乎被免費送上門
的 anchor——QR 是已知大小、已知幾何的視覺標籤，從它的四個角點 pixel
位置可以解出**相機的完整 6DoF pose**（3 軸位置 + 3 軸旋轉），而且
**在 iPhone Safari 上也能跑**（不依賴 WebXR）。

---

## 鎖定架構：Station-Based AR

把整個 Mode A 的追蹤拆成三層：

### 第一層 — Anchor：QR 定位站

- 在螺旋四周與內部**地面**或**支架**放置 5–8 個 QR code，每個代表一個
  觀賞站（A、B、C…）。
- QR 內容：JSON `{ "station_id": "A", "size_mm": 200 }`（假設 20 公分見方）。
- 客戶端用 **`@zxing/browser`** 在 `<video>` 的每一幀（或每隔幾幀）
  偵測 QR。拿到 QR 四角的 pixel 座標後，餵給 **OpenCV.js 的 `solvePnP`**，
  配合已知的實體 QR 角點座標，解出相機相對於 QR 的 6DoF pose
  （rotation matrix + translation vector）。
- 這個 pose 就是 Mode A 的「世界原點」——貼圖的世界座標都是相對於它
  定義的。

> **小知識：solvePnP 是什麼？**
> PnP 是 Perspective-n-Point 的縮寫。給你 n 個「世界上已知 3D 座標的點」
> 跟「它們在影像上的 2D 投影座標」，外加相機內參（focal length、principal
> point），就能反解出相機在世界座標系裡的位置跟朝向。QR 四個角正好
> 提供 4 個 3D–2D 對應，剛好夠用。

### 第二層 — Tracking：IMU 填補 QR 看不到的時候

當 QR 移出鏡頭（使用者轉頭、走近物件看細節等），需要某種東西繼續追蹤
相機姿態——不然貼圖就會卡在最後一次 pose。

- **`DeviceOrientationEvent`** 提供方位資料（alpha / beta / gamma），
  現代 iPhone 上旋轉飄移 < 1°/分鐘，公分級對位可以接受。
- **`DeviceMotionEvent`** 的加速度計理論上能積分出位移，但**會飄**
  （10 秒就有幾十公分誤差）。所以**我們不倚賴它做 translation**——
  觀賞站的 UX 假設使用者是**站著不移動**的。
- 每一幀 render 的相機 pose = `QR 最後一次解出的 pose` × `IMU 相對於
  該瞬間以來的旋轉增量`。

### 第三層 — Render：世界鎖定的貼圖

- DB 裡的 `placements` 欄位表示每個物件貼圖「相對於某個 anchor」的 3D
  transform（position, rotation, scale）。
- `@react-three/fiber` 每一幀用當前相機 pose 渲染這些貼圖。因為 pose
  是世界鎖定的，貼圖會穩穩地貼在該去的地方——即使使用者轉頭或微微移動，
  貼圖也不會「跟著畫面飄」。

### 再校準策略

為了避免 IMU drift 累積太多誤差：

- 只要任一幀裡偵測到 QR，立刻用 `solvePnP` 重解 pose，覆蓋掉現在的
  tracking 結果——**相當於自動把 drift 歸零**。
- 如果連續 N 秒沒看到 QR，或加速度計累計位移超過閾值，UI 提示「請對準
  地面的 QR 重新校準」。
- 展場還可以設計一個「導覽路徑」，從 A 站走到 B 站時，使用者會被引導
  再掃一次 QR。

### UX：離散觀賞站

相較於「邊走邊看 AR 連續貼合」的理想幻覺，我們走**離散的站點**：

- 使用者從入口 QR 進入網站。
- 畫面提示「請走到 Station A，對準地面的 QR 開始觀賞」。
- 掃到 QR → 鏡頭畫面出現 Station A 視角下 ~50 個物件的 AR 貼圖。
- 走到下一站前，畫面提示「請移動到 Station B 並重新掃描」。
- 200–300 個物件分散到 5–8 個站點，每站只看到一部分。這跟螺旋作品
  本身的「走進去慢慢發現」本來就是相容的。

---

## 為什麼不選 MindAR 當主要追蹤器

MindAR 的核心能力是「**給定一張 target 圖，在攝影機中找到它的位置
並回傳 homography**」。聽起來很適合，但有幾個問題：

- **Target 必須是一張 2D 圖。** 這個金屬網格是立體的，而且從不同視角
  看起來差很多——你無法用「一張照片」訓練一個通用 target。
- **戶外光線不穩定。** MindAR 的特徵描述子對光線變化敏感。
- **輸出是 2D 平面 pose，不是 3D 世界座標。** 要做公分級的 3D 物件對位，
  還是需要另一套世界座標系定義。

MindAR 未來還是可能派上用場——當作「輔助穩定器」，在 QR 看不到的期間
用網格的視覺特徵來修正 IMU drift。但那是 v2，**不是 v1 要做的事**。

---

## 為什麼不選 8th Wall / Lightship VPS

- 年費 USD 3–5K 起。
- 技術綁定高（換掉要重寫整個 AR 層）。
- 現在這套 QR + IMU 方案**在理論上就夠用了**，先實作看看效果，實測不行
  再考慮商業 SLAM。

---

## 這對 DB schema 的影響

在原本的 `artworks` / `objects` / `textures` / `placements` 四張表之外，
多一張：

```
anchors (
  id uuid primary key,
  station_label text,        -- "A" / "B" / ...
  size_mm int,               -- QR 實體尺寸
  venue_transform jsonb      -- 相對於 venue origin 的位置（cross-station 渲染用）
)
```

而 `placements` 要多一個 `anchor_id` 外鍵，表示這個貼圖的 transform
是**相對於哪個 station** 來解釋的：

```
placements (
  id uuid primary key,
  object_id uuid references objects(id),
  texture_id uuid references textures(id),
  anchor_id uuid references anchors(id),   -- new
  position jsonb,    -- {x, y, z} 相對於 anchor
  rotation jsonb,    -- quaternion
  scale jsonb,
  uv_transform jsonb
)
```

Cross-station 的 placement 在 render 時會從 `anchors.venue_transform`
組合出世界座標。這留到實作時再細化。

---

## 怎麼驗證會動（當我們開始寫 Mode A POC 時）

最小驗證步驟：

1. 印一張 A4 QR code（或手機顯示），貼在地上。
2. 頁面打開鏡頭，對準 QR，用 `@zxing/browser` 偵測並拿到四角座標。
3. 加進 OpenCV.js 的 `solvePnP`，印出解出的 rotation / translation。
4. 在 three.js 場景裡放一個 10cm × 10cm 的紅色立方體，position
   設成 `(0, 0, 0.3)`（QR 前方 30 公分）。
5. 打開畫面，應該看到紅色立方體**穩定地漂浮在 QR 前方 30 公分**——
   轉頭、轉手機、繞一圈 QR，它都該待在原地。

如果這一步跑得順，後續就是把 200–300 個物件換上真實 placement、接
lazy load、接 DB。

---

## 值得記住的決策

### 為什麼「觀賞站」UX 比「走到哪看到哪」更可行

**連續 6DoF 追蹤**在 iPhone Safari 上目前沒有免費開源且穩定的方案
（2026-04）。但**離散的定位站 + 每站內用 IMU 維持旋轉**這個簡化需求，
目前可用的 Web API 就能達成公分級。當你沒辦法做完美方案時，**改變
UX 來配合可行的技術**，而不是硬做做不到的技術。

### 為什麼堅持公分級而不妥協到公尺級

策展方明確要求。公分級用「QR 當 ground truth + IMU 填空檔 + 站定別動」
這個組合是可達成的；公尺級其實不需要 QR，IMU 配 compass 就夠。把需求
問清楚、做到剛好的精度，不多也不少。

### 為什麼不乾脆買 8th Wall

買之前先試。這套架構在概念上是合理的，理論 POC 成本低（一個週末可以
驗證基本 pose 計算是否 work）。如果 POC 實測飄很兇、或 QR 偵測對戶外
光線太敏感，**那時再買 8th Wall**，而且對 UX 衝擊最小（反正本來就是
「掃 QR → 看 AR」的模型）。

---

## 下一步候選（AR 追蹤決策之後）

1. **QR pose POC** — 單頁 demo：偵測 QR、解 6DoF、在 three.js 放一個
   世界鎖定的立方體。驗證整個 pipeline 可行。
2. **資料庫 schema 擴充** — 新增 `anchors` 表、加 `placements.anchor_id`
   欄位、寫 Alembic migration。
3. **Mode B 原型** — 不受 AR 追蹤決策影響，可以先做。載 glTF、實作手勢。
4. **Mode C 骨架** — Supabase Auth 登入 + `/_studio/<token>` 路由
   + 貼圖上傳界面。

建議先做 (1)——這是 Mode A 最核心、風險最高的部分，先驗證架構不會
卡關，其他東西才有意義。

---

## 今天沒遇到的地雷（但要先記下）

這些是實作時一定會踩的，先寫下來提醒未來的自己：

- **iOS 要求 HTTPS 才給 camera / motion 權限。** dev 環境記得用 Vite
  的 `--https` + `mkcert`。
- **iOS 的 `DeviceOrientationEvent` 需要額外呼叫 `requestPermission()`。**
  不是自動給的，要有一個「點這裡啟用」按鈕。
- **OpenCV.js bundle 很大（~8MB）。** 要用 dynamic import 只在
  Mode A 載入，不然前端啟動會很慢。
- **QR 偵測的 frame rate 要限流。** 不用每 frame 都解——每秒 10 幀
  大概就夠了，省電、省 CPU。
- **solvePnP 在 QR 接近鏡頭邊緣時會不穩。** 要做 confidence check，
  太偏的時候別用那一幀。
