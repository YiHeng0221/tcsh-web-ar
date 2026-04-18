# Figma Mockup Log

**建立日期：** 2026-04-18
**設計來源 spec：** [`claude-design-prompts.md`](./claude-design-prompts.md)

---

## TL;DR

在 Figma 建立 `tcsh-web-ar Mockups` 檔案，依 `claude-design-prompts.md`
的 16 個畫面規格產出 mockup。經過一輪 review 後調整尺寸決策：
**Mode A 只有手機、Mode B 手機 + 平板直式 + 平板橫式、Mode C 純桌機**。

---

## 檔案資訊

| 項目 | 值 |
| --- | --- |
| Figma file key | `emJGaE6FrrLbe6083mYrJf` |
| URL | <https://www.figma.com/design/emJGaE6FrrLbe6083mYrJf> |
| Team | Allen Wu's team（Professional plan） |
| 建立者 | `allenwu221@gmail.com` |

---

## Page 結構與尺寸決策

檔案分 3 個 page，每個 page 對應一個 Mode。

### Mode A — On-site AR（手機）

- 唯一尺寸：**iPhone 375 × 812**
- 使用情境：遊客現場使用，單手直握、只用手機
- 畫面（6 個）：
  - `A1 · Permission`
  - `A2 · Station Picker`
  - `A3 · QR Scanning`（3 variants：Searching / Detected / Locked）
  - `A4 · AR Viewing`（3 variants：Default / Tapped / Low-light）
  - `A5 · Object Detail Drawer`
  - `A6 · Next Station Guide`

### Mode B — 3D Viewer（手機 + 平板直式 + 平板橫式）

- 三種尺寸：
  - **手機** iPhone 375 × 812（y = 0）
  - **平板直式** iPad 834 × 1194（y = 1400）
  - **平板橫式** iPad 1194 × 834（y = 2750）
- 使用情境：遊客可能用手機或平板看 3D，平板橫式特別適合把玩模型
- 畫面（每種尺寸各 4 個，其中 B2 有 2 variants）：
  - `B1 · Loading`
  - `B2 · 3D Viewer`（Default / Gesture Hints）
  - `B3 · Object Search`
    - 手機：全螢幕 sheet
    - 平板直式：**底部 80% sheet**
    - 平板橫式：**右側 480px side panel**
  - `B4 · Object List`
    - 平板橫式：**2 欄 card list**

### Mode C — Creator Admin（桌機）

- 唯一尺寸：**Desktop 1280 × 800**
- 使用情境：策展人 / 創作者永遠在桌機做管理工作
- 畫面（6 個）：
  - `C1 · Login`（居中卡片式表單）
  - `C2 · Dashboard`（內容 max-width 960、兩欄配置：Quick Actions + Recent Activity）
  - `C3 · Texture Library`（**7 欄 grid**）
  - `C4 · Upload Dialog`（**modal 560 × 580，居中於暗底**）
  - `C5 · Placement Editor`（3-column：3D canvas + property panel + bottom thumbnail strip）
  - `C6 · Preview`（**modal + phone frame 居中**）

---

## 統計

| Mode | 畫面數 | Frame 數（含 variants/尺寸） |
| --- | --- | --- |
| Mode A | 6 | 10 |
| Mode B | 4 | 15（手機 5 + 平板直式 5 + 平板橫式 5） |
| Mode C | 6 | 6 |
| **總計** | **16** | **31** |

---

## Scope 變動歷程

### 版本 1 — 全手機
依 `claude-design-prompts.md` 原始 spec，16 個畫面全部畫成手機版。

### 版本 2 — Mode B 加平板直式
使用者回饋「平板版本，但只會有 Mode B」：
遊客看 3D 模型可能會用平板看得爽。新增 B1/B2×2/B3/B4 的 iPad portrait 版本。
B3 改成底部 80% sheet（對應 prompt spec 裡「or bottom 80% sheet on tablet」）。

### 版本 3 — Mode C 改純桌機
使用者回饋「Mode C 只會有桌機版」：
Admin / 策展人永遠在桌機工作，手機版沒必要。原 Mode C 手機版 6 張全部清掉、
重建桌機版（1280 × 800）。

### 版本 4 — Mode B 加平板橫式
使用者回饋「Mode B 也要有橫式」：
平板橫式適合把玩 3D。B3 改成右側 480px side panel、B4 改 2 欄卡片 list，
更利用橫向空間。

---

## 遇到的狀況

### Figma Starter plan MCP rate limit
初次畫到 Mode A 結束後（約 10 次 `use_figma` 呼叫），撞到：
```
You've reached the Figma MCP tool call limit on the Starter plan.
```
原因：Starter tier 對 MCP 工具呼叫有 quota 限制，與 Full seat 的 write-to-canvas
beta 是兩回事。

**解法：** 使用者升級到 Professional（$16/月，月繳），MCP 呼叫不再受限，
當天繼續完成 Mode B + Mode C。

### 短碼 hex color 踩雷
最初的 `hex('#555')` 會 return `{r, g, b: NaN}`，後來 `hex` function 加上
三碼展開成六碼的處理：
```js
if (h.length === 3) h = h.split('').map(c => c + c).join('');
```

---

## 後續怎麼用

1. **前端實作對照**：工程師做元件時直接對著 mockup 寫。每個 frame 的 naming
   對應到 `ui-design.md` 的畫面代號，找得到。
2. **要改 mockup**：直接編輯 Figma 檔，或請 AI 用 `use_figma` MCP 工具
   針對特定 frame 做改動。
3. **加新畫面**：先確認 Mode 對應尺寸（A 手機 / B 手機+平板 / C 桌機），
   再依 layout 節奏排位置。
4. **匯出 PNG 對外分享**：Figma 右鍵 export。或透過 MCP `get_screenshot`。

---

## 設計語言守則（對照 prompt spec）

- **顏色**：黑 `#000` + 白 `#FFF`，青色 `#00E5FF` 只用在 active station dot、
  tapped glow、primary CTA（Texture Library 的「+ 上傳新貼圖」按鈕、C5 的
  「儲存變更」、success pill、selected obj wireframe）。
- **Radius**：按鈕 8px、卡片 12px、drawer / bottom sheet 16px。
- **Typography**：Noto Sans TC（有則用）fallback 到 Inter。繁中 UI 文案。
- **Shadow**：僅 low-light 狀態與 tapped glow 才用 drop shadow。
- **iOS safe area**：Mode A / B 手機版都有 44px top safe + home indicator。
