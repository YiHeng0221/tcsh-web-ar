# Mode A v3 — SLAM 整合實作說明書

> **讀者：** 實作 agent（opus）。**作者：** fable。
> **前提：** `/dev/slam-mvp` 已實機驗證（貼圖世界鎖定、自由走動、4:3 全視野、
> 對齊 0.83px）。本說明書把 MVP 升級為 Mode A 的正式路線。
> 使用者拍板的三項需求（2026-06-13 05:19）：
> 1. **疊圖層問題**——提示 UI 與模式切換必須正確疊在引擎畫布之上
> 2. **重新掃 QR 重新定位**——隨時可重對齊，消除累積飄移
> 3. 保留模式切換（AR ↔ 3D）

---

## 0. 架構決策

- **SLAM 路線成為 Mode A 主線**：`/a/scan/:stationId` 與 `/a/view/:stationId`
  指向新的 `ARViewSlam`。
- **舊 IMU 路線（ARView）保留為 fallback**：`loadXR8()` 失敗（舊機型、引擎
  CDN 不可達）時自動降級並顯示「精簡模式」徽章。路由層做 try-SLAM-first。
- `/dev/slam-mvp` 保留作為實驗台（沙盒不動，正式畫面另建）。

## 1. 圖層系統（需求 1 的根治）

FullWindowCanvas 只管畫布；**所有 UI 收進單一 overlay root**：

```tsx
<div className="absolute inset-0 z-[10000] pointer-events-none">
  {/* 每個可互動子元件自己 pointer-events-auto */}
</div>
```

規則：
- 畫布（引擎管）z-auto；overlay root `z-[10000]`；其內部用相對層級
  （gate 50 > toast 40 > switch 30 > reticle 20 > HUD 10）。
- **絕不**在 overlay root 之外再放 UI 元素（這次 HUD 被蓋就是教訓）。
- 互動元件（按鈕）逐一 `pointer-events-auto`；root 保持 none 讓觸控
  穿透到畫布（引擎需要手勢）。

## 2. 狀態機（沿用 v2 心智模型，加 SLAM 階段）

```
permission-gate（同 v2：一鍵授權；沿用 permissions.ts + rearmOrientation）
  → slam-starting（引擎載入/相機啟動；XRExtras loading 可考慮，見 §5）
  → scanning（取景框「對準地面的 QR」+ luminance QR 迴圈 ~6fps）
  → viewing（貼圖世界鎖定；QR 迴圈降到 ~2fps 持續跑——見 §3）
  → (re-align flash) → viewing …
```

- mode switch（AR｜3D）：同 v2 右上角；切換前完整 teardown（XR8.stop、
  clearCameraPipelineModules、restoreConstraintShim、worker dispose）。
- 掃到**不同站**的 QR → 重算 T + 換 stationId + URL replace（v2 規則沿用）。

## 3. 連續重定位（需求 2 的設計）

- **自動**：viewing 中 QR 迴圈持續跑（2fps）。每次 solve 成功且
  reproj ≤ 8px → 重算 `T_slam←anchor` 並**直接 snap**（與 Mode A 哲學一致：
  站定場景，濾波延遲比抖動更傷）。畫面給 200ms 的細微「對齊脈衝」回饋
  （reticle 短暫浮現綠光）。
- **防抖**：沿用 pose-fusion 的 jitter guard 思路——連續 3 幀 reproj 突增
  2× 中位數才拒收（可把 `PoseFusion` 的 guard 邏輯抽成共用函式，或最小化
  地直接在 ARViewSlam 內實作同規則）。
- **手動**：overlay 提供「重新對準」按鈕（viewing 常駐、低調），按下 →
  回 scanning 態（清 aligned 旗標，引導使用者對 QR）。
- 對齊後**不再**整批重建 placements——`addPlacementsToScene` 改為把
  placements 掛在單一 `anchorGroup` 之下，重對齊只更新 `anchorGroup` 的
  matrix（避免每次重對齊 churn 場景物件）。

## 4. 資料

- 沿用 `usePlacements(stationId)`（目前 mock；API 接線是另一個 PR，不在
  本 scope）。
- `MOCK_QR_SIZE_MM`/anchor size 同 v2 的 TODO 註記。

## 5. 可偷的官方件（評估後採用，不強制）

- `XRExtras.Loading.pipelineModule()`：引擎啟動的官方 loading UI。**注意
  圖層**：它自帶 DOM，確認它不蓋 overlay root（必要時 CSS 收編）。
- `XRExtras.RuntimeError.pipelineModule()`：引擎錯誤畫面。
- 不採用 A-Frame——我們的 three.js pipeline 已實證。

## 6. 檔案配置

```
apps/web/src/modes/a/screens/ARViewSlam.tsx   # 新主畫面（狀態機 + overlay root）
apps/web/src/modes/a/screens/ARView.tsx        # 保留（fallback；改名不必）
apps/web/src/lib/slam/                         # 沿用 MVP 模組（alignment/load-xr8/qr-from-luminance/pnp 不變）
apps/web/src/lib/slam/realign.ts               # 重對齊 jitter guard（純函式 + 測試）
apps/web/src/router.tsx                        # /a/scan|view → ARViewSlam（lazy）
```

## 7. 紅線（REVIEW.md 全套適用）

- teardown 完備：XR8 stop/clear、constraint shim restore、worker、貼圖
  cache dispose（MVP 的 releaseAll 模式沿用）。
- XR8/xrextras 絕不進主 bundle（動態 script；驗 chunk）。
- TypeScript strict；UI 全繁中。

## 8. 驗收

- [ ] typecheck / test / build 綠；新增 realign 測試
- [ ] chunk 驗證：主 bundle 不變
- [ ] 桌機：顯示「請用手機」（沿用 MVP 行為）不炸
- [ ] 流程驗證（實機由使用者）：掃→對齊→走動→QR 再入鏡自動重對齊（脈衝
  回饋）→手動重新對準→mode switch 往返
- [ ] PR 拆法：一個 PR（畫面+realign lib）；超 800 行附 size-override 理由
