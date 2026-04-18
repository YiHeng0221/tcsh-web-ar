# Claude Design 提示語包

**用途：** 要把 `ui-design.md` 丟給 Claude Design 產視覺 mockup 時，
這份檔案是你的「複製貼上清單」。

**版本：** 2026-04-18 初稿

---

## Part 1 — Setup Form（三欄複製貼上）

### 欄位 1：Company name and blurb

```
tcsh-web-ar: A mobile web AR experience for a large outdoor public art installation — a 2m-tall spiral metal-mesh sculpture. Visitors scan a QR code on the ground, point their phone camera at the artwork, and see ~250 textures overlaid in real-time AR. Three modes: on-site AR viewing, handheld 3D viewer, and a hidden creator admin panel for uploading and placing textures. Mobile portrait only, no downloads, no account required.
```

### 欄位 2：Examples（全部選填）

- **GitHub link** — 若 `2enter/tcsh-web-ar` 已 push：填 `https://github.com/2enter/tcsh-web-ar`；沒 push 就跳過
- **Link code from computer** — 跳過（UI 目前還沒寫）
- **Upload .fig** — 跳過（沒有 Figma 檔）
- **Fonts, logos and assets** — **務必上傳兩張作品照片**：
  - 螺旋金屬網格完整作品照（有草地、樹在中央那張）
  - 手機舉起來看 AR 示意圖（貼圖是彩繪神像、米筐那張）

### 欄位 3：Any other notes?

```
Platform & form factor:
- Mobile browser only (iOS Safari + Android Chrome). Portrait only, single-handed thumb reach. No desktop / tablet layouts needed.

Visual language:
- Primary: black (#000) + white (#FFF), echoing the artwork's monochrome metal-mesh aesthetic.
- Accent: cyan #00E5FF — used sparingly for QR detection feedback, active station indicators, primary CTAs.
- Semantic: error #FF5252, warning #FFAB00, success #00C853.
- Typography: system fonts (-apple-system on iOS, Roboto on Android), Noto Sans TC for Traditional Chinese text. The product ships in Traditional Chinese (zh-Hant).
- Radius: 8px buttons, 12px cards, 16px bottom drawers.
- Elevation: minimal. One flat shadow level only.

UX principles (in priority order):
1. Camera first, UI second — in AR mode, all overlays are thin, semi-transparent, never block the artwork.
2. Zero-friction entry — from QR scan to AR view in 3 taps max.
3. No accounts for visitors. Admin panel is hidden behind an obfuscated URL + Supabase Auth login.

Three modes to design:
- Mode A: on-site AR viewer. 6 screens (permission, station picker, QR scanning, AR viewing, object detail drawer, next-station guide).
- Mode B: 3D model viewer. 4 screens (loading, viewer, object search, object list).
- Mode C: creator admin. 6 screens (login, dashboard, texture library, upload, placement editor, preview).

Brand voice: calm, museum-catalogue tone. Reverent toward the artwork, invisible as interface. Never playful or cute.

Key constraints:
- The artwork is outdoors, so UI must stay legible under direct sunlight — high contrast mandatory.
- No markers can be placed on the artwork itself. AR anchors are QR codes on the ground around the artwork.
```

---

## Part 2 — 16 個畫面的獨立 Prompt

建議產出順序跟 `ui-design.md` 的「實作順序建議」一致：A4 → A3 → B2 → B1 → A2 → A6 → C1 → C2 → C3 → C4 → C5 → C6 → A5 → B3 → B4 → A1。核心畫面先產，風險消了再做細節。

每則 prompt 獨立成章，可以一則一則丟進 Claude Design 的 chat sidebar。

---

### A4 · AR Viewing Screen（核心畫面，最先產）

```
Design Mode A — "AR Viewing" screen (A4). This is THE hero screen of the entire product.

Full-screen portrait layout:
- Background: live camera feed (mock with a dark photo of the outdoor spiral metal-mesh artwork shown from inside the spiral).
- Overlay plane: 5–8 "texture tiles" rendered as if world-locked to the real artwork — represent them as semi-floating rectangular photo panels at varying depths. Use 3–4 sample images of traditional Taiwanese folk art / deity paintings as placeholder textures.

Top status bar (48px, rgba(0,0,0,0.5) background):
- Left: back chevron
- Center: "Station A · 52 objects" in white, 14px
- Right: overflow menu (⋮)

Bottom area (safe zone, above home indicator):
- Station progress indicator: 5 dots labeled A B C D E; current station (A) is filled with cyan #00E5FF, others are hollow white.
- Subtle hint text below: "點擊任一物件查看資訊" in 12px semi-transparent white.

Visual rules:
- No panels, no cards — just overlays on camera.
- Text has a subtle 1px dark outline for sunlight legibility.
- The cyan accent appears ONLY on the active station dot.
- Tiles should have a barely-visible cyan glow on hover-state variant.

Deliver three variants:
1. Default viewing state
2. One texture tapped (cyan glow ring)
3. Low light / overcast variant (same layout, slightly warmer auto-exposure)
```

---

### A3 · QR Scanning Screen

```
Design Mode A — "QR Scanning" screen (A3). User is pointing phone at the ground to find a station QR code.

Full-screen portrait:
- Background: live camera feed (mock: a photo of grass / paving stone with a printed QR code visible near center).
- Center: a dashed-line rectangular guide frame (70% screen width square), semi-transparent white, suggesting "place QR inside this box".
- When QR is detected (variant 2), the dashed guide disappears and a solid cyan #00E5FF quadrilateral is drawn tightly around the actual QR code corners.

Top status bar:
- Left: back chevron
- Center: "尋找 QR" in white, 14px
- Right: ⋮

Bottom area:
- Info toast (pill-shaped, rgba(0,0,0,0.7) background, white text): "⓵ 請將 QR 放在畫面中央"
- Toast floats 80px above bottom edge.

Transitions to suggest in the mockup:
1. Searching state (dashed guide, info toast)
2. Detected state (cyan solid outline, no toast, subtle pulse animation hint)
3. Locked state (just before advancing to A4 — brief cyan fill + checkmark)
```

---

### B2 · 3D Viewer Main Screen

```
Design Mode B — "3D Viewer" main screen (B2). Handheld 3D model browsing.

Full-screen portrait:
- Background: pure black #000 or very dark charcoal #0A0A0A for maximum model contrast.
- Center: the full 3D artwork (a 2m-tall spiral metal-mesh cylinder, open at the top, inner-facing) rendered with subtle rim lighting against the black background. Model takes ~70% of screen height, centered.
- The model is rotatable (mock showing mid-rotation).

Top status bar:
- Left: back chevron
- Center: "3D 檢視" in white, 14px
- Right: ⋮

Bottom toolbar (pill container, rgba(255,255,255,0.05) glass effect):
- Three icon buttons evenly spaced: 🔄 重置視角 · 🔍 搜尋物件 · ☰ 列表
- Icons are line-style, white, 20px.

Optional first-visit gesture hint overlay (variant 2):
- Semi-transparent dark overlay
- Two-finger pinch icon + "雙指縮放" label
- Single-finger swipe icon + "單指旋轉" label
- "知道了" dismiss button at bottom

Deliver:
1. Main state (no overlays)
2. First-visit state with gesture hints
```

---

### B1 · Loading Screen

```
Design Mode B — "Loading" screen (B1). Shown while the glTF model downloads (10–30MB).

Full-screen portrait, pure black background:
- Upper third: centered spinner (thin circular progress ring, cyan #00E5FF, 48px)
- "載入 3D 模型中 ..." label in white, 16px
- Progress bar: 240px wide, 3px tall, subtle track + cyan fill. Label "████████████░░░░░  72%" style, with numeric percentage on the right.
- Lower third: a rotating "小知識" card (8px radius, rgba(255,255,255,0.04) background, 16px padding), white text: "這個作品由 {藝術家} 創作，包含 253 個獨立物件。"

Everything vertically centered with generous whitespace. No other chrome.
```

---

### A2 · Station Picker

```
Design Mode A — "Station Picker" screen (A2). Shown after permission grant, before scanning QR.

Full-screen portrait, white background:
- Top status bar (this screen uses solid, not transparent, since there's no camera feed): dark text on white.
- Title: "找一個站點開始" in 24px black, semibold, centered, with 32px top margin.
- Main card (12px radius, subtle 1px border #EEE):
  - Height ~55% of screen.
  - Contains a stylized SVG floor plan of the spiral artwork: an outline spiral shape + 5 labeled dots (ⓐ ⓑ ⓒ ⓓ ⓔ) at the station locations around and inside the spiral.
  - No legend needed — the dots are self-explanatory.
- Below card: hint text "走到任一站點並對準地面 QR" in 14px gray #666, centered.
- Bottom primary CTA button (full-width minus 24px side margin, black background, white text, 8px radius, 56px tall): "📷  開啟相機掃描 QR"

Clean, calm, minimal. No extraneous decoration.
```

---

### A6 · Next Station Guide

```
Design Mode A — "Next Station Guide" screen (A6). Appears after a station is "completed" or user taps forward.

Full-screen portrait, white background:
- Top status bar: "下一個站點" title, back chevron.
- Success pill at top of content area: "✓ Station A 已完成" in cyan #00E5FF, 14px, centered.
- Main directional instruction in 28px black, centered, two lines:
  - "→  往右前方 8 公尺"
  - "找到 Station B"
- Floor plan card (same styling as A2, but with path annotation):
  - Station A marked with ✓
  - Dashed arrow leading from A to B
  - Station B marked with a pulsing cyan dot
- Two-button row at bottom:
  - Left (secondary, white bg + 1px border): "跳過此路徑"
  - Right (primary, black bg + white text): "掃描 Station B"
- Buttons 48px tall, 8px radius, 12px gap.
```

---

### C1 · Login

```
Design Mode C — "Login" screen (C1). Creator admin, hidden route /_studio/<token>.

Full-screen, light background (#FAFAFA or similar subtle off-white). Desktop-friendly layout too (not just mobile).

Content centered both axes:
- Wordmark at top: "tcsh-web-ar Studio" in serif-like heavy font, 24px, black. Small neutral illustration or icon above it (e.g. a tiny geometric shape).
- Card (max-width 360px, 16px radius, white bg, 1px border #EEE, 32px padding):
  - Label "Email" (12px, gray) → input field (40px tall, 8px radius, 1px border).
  - Label "Password" → input field.
  - Primary button full-width: "登入" (black bg, white text, 8px radius, 44px tall).
- Footer: "Supabase Auth 驅動" in 12px gray, centered, 32px below card.

Minimal, serious, museum-institutional. No illustrations of happy people using laptops. Just the form.
```

---

### C2 · Dashboard

```
Design Mode C — "Dashboard" screen (C2). First page after login.

Responsive layout — think mobile-first but looks good on tablet / desktop too.

Top bar (full width, 56px tall, white bg, 1px bottom border):
- Left: wordmark "tcsh-web-ar Studio" 16px semibold
- Right: user email + "登出" button

Main content (max 960px centered, 24px padding):

Section 1 — Stat cards row (3 cards, equal width, 16px gap, 120px tall each):
- Card style: 12px radius, white bg, 1px border #EEE, 24px padding.
- Card A: huge number "253" (48px black semibold), label below "物件總數" (14px gray).
- Card B: "184" + "已上貼圖" + progress indicator showing 184/253.
- Card C: "5" + "站點".

Section 2 — "快速動作" (14px gray semibold label):
- Card containing 4 action rows, each with icon + label + chevron right:
  - 📤  上傳貼圖
  - 🎯  編輯 placement
  - 📍  管理 anchor
  - 👀  預覽 Mode A / B
- Rows: 56px tall, 1px divider between.

Section 3 — "最近活動" (14px gray semibold label):
- List of timestamped activity items, 48px tall each, with subtle timestamp left and description right.

No colors beyond black, white, gray, and cyan for active states.
```

---

### C3 · Texture Library

```
Design Mode C — "Texture Library" screen (C3).

Same top bar as C2, with back chevron left and page title "貼圖庫" center, primary button "[+ 上傳新貼圖]" right (cyan bg, white text, 8px radius).

Filter bar below top bar (48px tall, white, 1px bottom border):
- Left: search input "搜尋..." with 🔍 icon, 240px wide.
- Right: dropdown "篩選: [全部 ▾]".

Main grid:
- Responsive grid of texture thumbnails. Mobile: 3 columns. Tablet: 5. Desktop: 6–8.
- Each tile: square aspect ratio, 8px radius, 1px border #EEE.
- Bottom-right corner of tile: small cyan ✓ badge if texture is assigned to an object.
- Bottom-left: tiny tile number label "042" in 10px gray.
- Hover / tap state: 2px cyan outline.

No card shadows. Flat, gallery-like presentation.
```

---

### C4 · Upload Dialog

```
Design Mode C — "Upload" screen (C4). Modal / full-screen dialog triggered from Texture Library.

Full-screen on mobile, centered modal on desktop (max 560px wide, 16px radius, white bg).

Header:
- Title "上傳貼圖" (20px semibold)
- Close ✕ top-right

Drop zone (dashed 2px border #CCC, 12px radius, 280px tall, padding 24px, centered content):
- 📁 icon (48px, gray)
- Primary line "拖曳圖片到這裡" (18px black)
- Secondary line "或點擊選擇檔案" (14px gray)
- Tertiary line "支援格式：JPG, PNG, WebP, KTX2 · 最大 10MB" (12px gray)
- On drag-over state: border becomes solid cyan, background light-cyan tint.

Selected files list (appears below drop zone after selection):
- Each file row: 56px tall, 1px bottom divider.
- Left: small file icon + filename + size
- Right: ✕ remove button
- When uploading: thin cyan progress bar along bottom 1px of row.

Footer buttons:
- Left: "取消" (text button, gray)
- Right: "開始上傳" (primary, black bg, white text, 8px radius)

Show two variants:
1. Empty drop zone
2. Two files selected, one mid-upload (60% progress)
```

---

### C5 · Placement Editor (Most Complex)

```
Design Mode C — "Placement Editor" screen (C5). The most complex admin screen.

Desktop-first (1280px+ layout), with a simpler mobile fallback.

Top bar (56px): back, title "Placement 編輯器", right actions "[預覽]" (secondary) + "[儲存變更]" (primary cyan).

Main area — three-column layout:

LEFT (flexible width, ~60% of remaining): 3D canvas
- Background: very dark #0A0A0A.
- Full 3D artwork rendered centered, same style as B2.
- One object is selected: highlighted with a cyan wireframe outline.
- Selected object has small floating label near it: "obj_042".

RIGHT sidebar (360px fixed): property panel
- Panel title: "物件屬性" (14px gray semibold, 16px padding)
- Form rows, 8px vertical rhythm:
  - "ID: obj_042" (read-only, gray text, small)
  - Input "Label: [彩繪神像]"
  - Select "Anchor: [Station A ▾]"
  - "Texture" section with 80×80 preview thumbnail + "[更換]" button
  - Subsection "UV Transform" (12px gray label):
    - Scale X, Scale Y, Rotate, Offset X, Offset Y — each as a small numeric input (60px wide)
  - Subsection "Position":
    - X, Y, Z numeric inputs
- All inputs: 32px tall, 6px radius, 1px border #EEE.
- Changes are not autosaved — a small pending indicator "●未儲存" appears if any field is edited.

BOTTOM horizontal strip (80px tall, spans full width under canvas + sidebar):
- Horizontal scrollable list of object thumbnails (60×60 each, 8px gap), currently-selected has cyan border.
- Scrolls with pointer / touch.

Style is serious, data-dense, no decorative illustration. Think Figma plugin panel, not marketing site.
```

---

### C6 · Preview

```
Design Mode C — "Preview" screen (C6). Shown when admin clicks "[預覽]" in the placement editor.

Full-screen modal with a device-frame mockup in the center:
- Background: dark gray #222, 16px padding.
- Phone frame illustration (rounded rectangle with notch, 375×812 iPhone-like) centered.
- Inside the phone frame: an iframe rendering Mode A's A4 (AR Viewing) or Mode B's B2 (3D Viewer) — let the admin toggle.

Top of modal:
- Close ✕ left
- Toggle tabs center: [Mode A] [Mode B]
- "在真機開啟 ↗" link right (opens a QR modal so admin can scan and test on phone)

Simple, utilitarian. Not a selling surface — just a preview tool.
```

---

### A5 · Object Detail Drawer

```
Design Mode A — "Object Detail" bottom drawer (A5). Appears when user taps a world-locked texture in A4.

Context: AR viewing screen is still visible behind a semi-transparent dark overlay (rgba(0,0,0,0.4)).

Drawer occupies bottom 50% of screen:
- Bottom sheet style: 16px top-corner radius, white bg.
- Drag handle pill at top center (4×40px, gray #CCC) — suggests drag-to-dismiss.
- Close ✕ top-right.

Content (20px padding):
- Row 1: thumbnail (80×80, 8px radius) on left + texture title + station label stacked on right:
  - Title: "彩繪神像" (18px black semibold)
  - Subtitle: "Label · Station A" (12px gray)
- Row 2: body text (14px, line-height 1.6, black) — ~3 lines of placeholder artwork description.
- Row 3 (buttons): two buttons side-by-side (gap 12px, each flex-1):
  - "分享" (secondary: white bg, 1px border)
  - "收藏" (primary: black bg, white text)
  - 44px tall, 8px radius.

Drawer is independent of the AR engine — the camera feed continues to run behind.
```

---

### B3 · Object Search

```
Design Mode B — "Object Search" sheet (B3). Slides up from bottom in the 3D viewer.

Full-screen sheet (or bottom 80% sheet on tablet):
- Top: close ✕ left.
- Search input (full-width minus 24px padding): pill-shaped (24px radius), 48px tall, 🔍 icon left, placeholder "搜尋物件名稱或編號".
- Results list below search:
  - Each result row: 72px tall, 1px bottom divider.
  - Left: 56×56 square thumbnail with 8px radius.
  - Right (stacked, 12px gap from thumb): "物件 042" (14px semibold) + "彩繪神像" (13px normal) + "Station A" (12px gray).
  - Entire row tappable, subtle cyan highlight on press.
- No empty-state illustration — just a quiet "尚無符合結果" 14px gray centered if empty.

Virtualized scrolling (no visual indicator needed).
```

---

### B4 · Object List

```
Design Mode B — "Full Object List" sheet (B4). Same interaction model as B3, but no search bar at top.

- Top: close ✕ left, title "全部物件" center (16px semibold), subtitle "253 項" right (12px gray).
- Optional sort menu top-right: "排序 ▾" (A→Z / by station / by placement date).
- Rest of layout identical to B3 results list.

When scrolled: a sticky letter-header separator appears (e.g. "A" / "B" / "C"), 32px tall, subtle gray bg, for quick jump.
```

---

### A1 · Permission Screen

```
Design Mode A — "Permission Request" screen (A1). First thing visitors see after scanning the entry QR.

Full-screen portrait, white background with subtle top image (can be a blurred crop of the artwork photo as atmospheric header, 35% screen height, overlaid with a light white gradient fade toward bottom).

Below the atmospheric image:
- Welcome title: "歡迎來到 {作品名稱}" (24px black semibold, centered, 24px top margin)
- Card (max-width 340px centered, 16px radius, white, 1px border #EEE, 32px padding):
  - 📷 icon (40px, black) at top center.
  - Heading "需要以下權限才能開始體驗" (16px black, centered).
  - Bulleted list (left-aligned, 8px vertical gap, 14px):
    - ✓ 相機 — 疊加 AR 貼圖
    - ✓ 方位 — 追蹤手機角度
  - Primary CTA button full-width: "開始體驗" (black bg, white text, 8px radius, 48px tall).
- Footer links (below card, 32px margin-top, 14px gray, centered, separated by " · "):
  - 使用說明 · 關於

Tone: polite, institutional, respectful of user's attention.
```

---

## Part 3 — 迭代策略

### 一則一則產還是一次全部丟？

**建議分批：**

1. **第一批（Hero batch）**：A4 + B2 + C2
   產完看方向對不對——這三個涵蓋三個 Mode 的主幹畫面，看完就能判斷整體視覺 tone 對不對。
2. **第二批（Mode A 完整）**：A3 + A2 + A6 + A5 + A1
   Hero 方向 OK 後，把 Mode A 的 6 個畫面產完，整個使用者 flow 就完整了。
3. **第三批（Mode B 完整）**：B1 + B3 + B4
4. **第四批（Mode C 完整）**：C1 + C3 + C4 + C5 + C6

### 收到輸出後要檢查什麼

每個畫面至少要看三件事：

1. **視覺語言一致性**：黑白 + 青色強調有沒有守住？元件 radius、shadow 有沒有跟其他畫面打架？
2. **資訊層級**：使用者第一眼會看到什麼？是你想要的嗎？
3. **手機直式比例**：有沒有元件超出安全區？底部按鈕會不會被 home indicator 擋到？

### 常見要補的 feedback

Claude Design 傾向產「常見 SaaS」風格。這專案是藝術展覽場景，可能需要追補：

- 「減少 icon 使用，這是博物館場景不是 productivity app」
- 「字距再寬一些，讓氣質更安靜」
- 「cyan 用太多了，只保留 active station 和 primary CTA」
- 「不要放漸層背景，維持純色塊」

### 匯出後的下一步

1. **匯到 Canva** — 給設計師或策展方看。
2. **匯 PNG** — 放進 `docs/mockups/` 目錄，commit 進 repo，方便日後對照。
3. **當成實作參考** — 工程師實作元件時直接對著 mockup 寫。

---

## 附註

- 這份 prompt 集合預設你已經把 `ui-design.md` **或**兩張作品照都上傳給 Claude Design 了。如果沒上傳，每則 prompt 的產出品質會下降。
- 若同一個畫面第一次產的不夠好，不要改 prompt——直接在 chat 裡用自然語言修（例如「字距再寬一些」、「cyan 改成只用在 active station」）。Claude Design 支援 inline 編輯與留言。
