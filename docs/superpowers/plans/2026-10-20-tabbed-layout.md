# Tabbed Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** แยกหน้าเดียวที่ยาวเป็น 4 แท็บ (Timesheet · ผลลัพธ์ · แก้เกิน 80% · ตั้งค่า) พร้อมตัวเลขสรุป แถบเตือน การลากไฟล์มาวาง และหน้าตาใหม่ โดยไม่เปลี่ยนการคำนวณ

**Architecture:** ทุกอย่างยังอยู่ใน `index.html` ไฟล์เดียว การ์ดเดิม (id เดิมทุกตัว) ถูกย้ายไปอยู่ใน `<section class="view" data-view="...">` 4 อัน router เล็ก ๆ ใน UI IIFE โชว์ทีละ view ตาม `location.hash` มี `renderStatus()` ตัวเดียวคอยอัปเดต KPI, แถบเตือน, badge, empty state และแถบสถานะหลัง Apply ส่วน logic เพิ่มแค่ `summaryKpis` (ฟังก์ชันล้วน)

**Tech Stack:** HTML/CSS/JS ไฟล์เดียว (ไม่มี build), Node `assert`, Python Playwright

**Spec:** [docs/superpowers/specs/2026-10-20-tabbed-layout-design.md](../specs/2026-10-20-tabbed-layout-design.md)

## Global Constraints

- ทั้งแอปอยู่ใน `index.html`: logic ใน `<script id="app-logic">` (ฟังก์ชันล้วน export ผ่าน `module.exports`) ส่วน UI อยู่ใน IIFE ของ `<script>` ตัวสุดท้าย ฟังก์ชันของ logic เรียกจาก UI ได้ตรง ๆ
- ห้ามเปลี่ยน id ของ element เดิม ห้ามเปลี่ยน localStorage key และห้ามแก้ logic อื่นนอกจากเพิ่ม `summaryKpis`
- ข้อความบนหน้าเว็บเป็นภาษาไทย ชื่อโค้ดและ comment เป็นภาษาอังกฤษ เขียนให้เหมือนโค้ดรอบข้าง
- คำสั่ง test: `node tests/all.js` (ต้องขึ้น `ALL TEST FILES PASSED`) และ `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py` (ต้องขึ้น `all N browser tests passed` ใช้เวลา 4–6 นาที และต้องต่อเน็ต)
- test ใหม่ใน `tests/browser_e2e.py` ต้องเพิ่มลงลิสต์ `TESTS` ท้ายไฟล์ด้วยเสมอ ส่วน test ใหม่ใน `tests/run-tests.js` วางก่อน `process.on('exit'`
- ตั้งแต่ Task 2 เป็นต้นไป การคลิก / พิมพ์ / เลือกใน browser test ต้องผ่าน helper `click` / `fill` / `select` และก่อนเช็ก `to_be_visible()` / `to_be_hidden()` ของ element ที่อยู่ใน view ต้องเรียก `reveal(page, ...)` ก่อน
- commit message จบด้วย `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`
- ห้าม `git push`
- ทำงานใน worktree `D:\02_Work\code_project\time_sheert\.claude\worktrees\tabbed-layout` (branch `tabbed-layout`) เท่านั้น

---

### Task 1: `summaryKpis` (logic + Node test)

**Files:**
- Modify: `index.html` ส่วน logic: วางฟังก์ชันใหม่ต่อจาก `function buildTable2(...) { ... }` และเพิ่มชื่อ `summaryKpis` ต่อจาก `buildTable2` ในบรรทัด export `parseNum, parseDataRows, classifyRows, buildTable1, buildTable2, MH_PER_DAY,`
- Test: `tests/run-tests.js`

**Interfaces:**
- Produces: `summaryKpis(table1, table2, threshold): { squads: number, overSquads: string[], totalMD: number, opexPct: number | null }` โดย `table1` / `table2` มาจาก `buildTable1` / `buildTable2` (`table2[i]` มี `sq, capexMH, opexMH, capexPct, opexPct` ส่วน `table1.grandTotal` เป็น Man-Day)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** วางก่อน `process.on('exit'` ใน `tests/run-tests.js`

```js
test('summaryKpis counts squads, flags those over the threshold, totals Man-Day and overall OPEX', () => {
  const r = (sq, wo, category, mh) => ({ sq: sq, woKey: wo, woLabel: wo, woNo: wo, category: category, mh: mh });
  const cl = [r('S1', 'C1', 'CAPEX', 8), r('S1', 'O1', 'OPEX', 72), r('S2', 'C1', 'CAPEX', 8), r('S2', 'O1', 'OPEX', 8), r('S2', 'Z01', 'NON_CHARGE', 8)];
  const k = App.summaryKpis(App.buildTable1(cl), App.buildTable2(cl), 0.8);
  assert.strictEqual(k.squads, 2);
  assert.deepStrictEqual(k.overSquads, ['S1']);
  assert.strictEqual(k.totalMD, 13); // 104 MH / 8
  assert.ok(Math.abs(k.opexPct - 80 / 96) < 1e-12);
});

test('summaryKpis: exactly 80% is not over; no CAPEX/OPEX gives opexPct null', () => {
  const r = (sq, wo, category, mh) => ({ sq: sq, woKey: wo, woLabel: wo, woNo: wo, category: category, mh: mh });
  const at80 = [r('S1', 'C1', 'CAPEX', 2), r('S1', 'O1', 'OPEX', 8)];
  assert.deepStrictEqual(App.summaryKpis(App.buildTable1(at80), App.buildTable2(at80), 0.8).overSquads, []);
  const nc = [r('S1', 'Z01', 'NON_CHARGE', 8)];
  const k = App.summaryKpis(App.buildTable1(nc), App.buildTable2(nc), 0.8);
  assert.strictEqual(k.opexPct, null);
  assert.strictEqual(k.totalMD, 1);
});
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `node tests/run-tests.js`
Expected: 2 บรรทัด `FAIL` (`App.summaryKpis is not a function`)

- [ ] **Step 3: เขียนโค้ด** ต่อจาก `function buildTable2`

```js
// Headline numbers for the results tab: squad count, squads over the OPEX
// threshold (in Table 2 order), total Man-Day, and the OPEX share overall.
function summaryKpis(table1, table2, threshold) {
  const capex = table2.reduce((a, r) => a + r.capexMH, 0);
  const opex = table2.reduce((a, r) => a + r.opexMH, 0);
  return {
    squads: table2.length,
    overSquads: table2.filter(r => r.opexPct != null && r.opexPct > threshold).map(r => r.sq),
    totalMD: table1.grandTotal,
    opexPct: capex + opex > 0 ? opex / (capex + opex) : null
  };
}
```

แก้บรรทัด export: `parseNum, parseDataRows, classifyRows, buildTable1, buildTable2, summaryKpis, MH_PER_DAY,`

- [ ] **Step 4: รัน test ต้องผ่าน**

Run: `node tests/all.js`
Expected: `ALL TEST FILES PASSED`

- [ ] **Step 5: Commit** (รวมการแก้ spec ที่ค้างอยู่ใน working tree ด้วย)

```bash
git add index.html tests/run-tests.js docs/superpowers/specs/2026-10-20-tabbed-layout-design.md
git commit -m "feat: add summaryKpis for the results tab headline numbers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: browser test helper ที่สลับแท็บให้เอง (ยังไม่แตะ UI)

**Files:**
- Modify: `tests/browser_e2e.py`

**Interfaces:**
- Produces (ใช้ใน Task 3–6):
  - `view_el(page, name)` → locator ของ `section.view[data-view=name]`
  - `show(page, name)` คลิกแท็บใน nav แล้วรอให้ view นั้นโชว์
  - `reveal(page, target)` (target = selector string หรือ locator) เปิด view ที่ element นั้นอยู่ (ถ้ามี และยังไม่โชว์) แล้วคืน locator
  - `click(page, target)`, `fill(page, target, value)`, `select(page, target, value)`

ตอนนี้ยังไม่มี `section.view` เลย `reveal` จึงไม่ทำอะไร test ทั้ง 52 ข้อต้องผ่านเหมือนเดิม task นี้เตรียมไว้ให้ Task 3 แยกแท็บได้โดย test ไม่พัง

- [ ] **Step 1: เพิ่ม helper** ต่อจาก `def paste_into_grid(...)` ใน `tests/browser_e2e.py`

```python
def view_el(page, name):
    return page.locator('section.view[data-view="' + name + '"]')


def show(page, name):
    # Same as a user clicking the tab in the top nav.
    page.locator('[data-view-link="' + name + '"]').click()
    expect(view_el(page, name)).to_be_visible()


def reveal(page, target):
    # Only one tab (view) is visible at a time and Playwright can't click,
    # type into or judge the visibility of elements in a hidden one — open
    # the view the element lives in first. Elements outside any view (nav,
    # banners) are left alone.
    loc = page.locator(target) if isinstance(target, str) else target
    name = loc.first.evaluate("el => { const v = el.closest('section.view'); return v ? v.dataset.view : ''; }")
    if name and not view_el(page, name).is_visible():
        show(page, name)
    return loc


def click(page, target):
    reveal(page, target).first.click()


def fill(page, target, value):
    reveal(page, target).fill(value)


def select(page, target, value):
    reveal(page, target).select_option(value)
```

- [ ] **Step 2: เปลี่ยน `page.click(...)` ทั้งไฟล์ให้ผ่าน helper**

Run:
```bash
sed -i 's/page\.click(/click(page, /g' tests/browser_e2e.py
```
แล้วเช็กว่า helper `click` เองไม่ได้ถูกเปลี่ยนด้วย (บรรทัด `def click(page, target):` ต้องยังเป็น `reveal(page, target).first.click()`): `grep -n "page.click(\|def click" tests/browser_e2e.py` ต้องเหลือแค่บรรทัด `def click`

- [ ] **Step 3: เปลี่ยนการพิมพ์ / เลือก / คลิกผ่าน locator ด้วยมือ** ไล่ตามผลของ `grep -n "\.fill(\|\.select_option(\|\.click()\|page\.fill(" tests/browser_e2e.py` แล้วเปลี่ยนตามตัวอย่าง (ยกเว้นบรรทัดใน helper `show` / `reveal` / `click` / `fill` / `select` ที่เพิ่งเขียน):

| เดิม | ใหม่ |
|---|---|
| `grid_cell(page, 'timesheet-grid', 1, day_col(10)).fill('7')` | `fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(10)), '7')` |
| `opex11.fill('8')` | `fill(page, opex11, '8')` |
| `draft_field(page, 0, 'mh').fill('4')` | `fill(page, draft_field(page, 0, 'mh'), '4')` |
| `mh.fill('4')` | `fill(page, mh, '4')` |
| `page.fill('#working-days-input', working_days)` | `fill(page, '#working-days-input', working_days)` |
| `page.locator('#table1-container .remaining-input[data-wo-key="C1"]').fill('10')` | `fill(page, '#table1-container .remaining-input[data-wo-key="C1"]', '10')` |
| `grid_row_where(...).locator('input').nth(3).fill('99')` | `fill(page, grid_row_where(...).locator('input').nth(3), '99')` |
| `draft_field(page, 0, 'toWoKey').select_option('C2')` | `select(page, draft_field(page, 0, 'toWoKey'), 'C2')` |
| `select.select_option('C2')` (ถ้ายังมี) | `select(page, select, 'C2')` |
| `btn.click()` / `cell.click()` | `click(page, btn)` / `click(page, cell)` |

- [ ] **Step 4: เปิดแท็บก่อนเช็กการมองเห็น** ไล่ตาม `grep -n "to_be_visible()\|to_be_hidden()" tests/browser_e2e.py` ทุกบรรทัดในฟังก์ชัน test (ไม่รวม helper `show`) ให้เพิ่ม `reveal(page, <locator เดียวกัน>)` ไว้บรรทัดก่อนหน้า เช่น:

```python
    reveal(page, '#rebalance-card')
    expect(page.locator('#rebalance-card')).to_be_visible()
```

และ

```python
    reveal(page, '#changelog-card')
    expect(page.locator('#changelog-card')).to_be_hidden()
```

(ถ้า assertion ใช้ตัวแปร locator เช่น `expect(btn).to_be_visible()` ให้ใช้ `reveal(page, btn)`)

- [ ] **Step 5: รัน test ต้องผ่านเหมือนเดิม**

Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `all 52 browser tests passed`

- [ ] **Step 6: Commit**

```bash
git add tests/browser_e2e.py
git commit -m "test: route browser test interactions through view-aware click/fill/select/reveal helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: แยก 4 แท็บ + router + Run แล้วเด้งไปผลลัพธ์

**Files:**
- Modify: `index.html` (`<head>`, CSS, markup ระหว่าง `<header class="page-head">` กับการ์ด `#changelog-card`, UI IIFE)
- Modify: `tests/check-structure.js`
- Test: `tests/browser_e2e.py`

**Interfaces:**
- Consumes: helper จาก Task 2
- Produces (UI IIFE): `VIEWS`, `currentViewFromHash()`, `showView(name)`, `goToView(name)` และ element ใหม่ `#rebalance-badge`, `#results-empty`, `#kpi-tiles`, `#results-over-banner`, `#rebalance-empty`, `#timesheet-rebalance-strip`, `#xlsx-dropzone` (Task 4–5 จะเติมพฤติกรรมให้)

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน**

(a) ใน `tests/check-structure.js` เพิ่มบรรทัดนี้ท้ายลิสต์ `requiredIds` (ต่อจาก `'changelog-card', 'changelog-container', 'copy-changelog-btn', 'download-changelog-btn'` อย่าลืมใส่ comma ท้ายบรรทัดเดิม):

```js
  'rebalance-badge', 'results-empty', 'kpi-tiles', 'results-over-banner', 'rebalance-empty', 'timesheet-rebalance-strip', 'xlsx-dropzone'
```

(b) ใน `tests/browser_e2e.py` เพิ่มฟังก์ชันเหล่านี้ไว้ก่อน `def run_without_mapping_shows_error`:

```python
def first_visit_shows_only_the_timesheet_tab(page):
    expect(view_el(page, 'timesheet')).to_be_visible()
    for name in ('results', 'rebalance', 'settings'):
        expect(view_el(page, name)).to_be_hidden()
    expect(page.locator('[data-view-link="timesheet"]')).to_have_attribute('aria-current', 'page')


def tabs_follow_the_hash_across_reload_and_back(page):
    show(page, 'settings')
    assert page.url.endswith('#settings'), page.url
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(view_el(page, 'settings')).to_be_visible()
    show(page, 'results')
    page.go_back()
    expect(view_el(page, 'settings')).to_be_visible()


def run_success_jumps_to_results_but_errors_stay(page):
    click(page, '#clear-mapping-btn')
    show(page, 'timesheet')
    click(page, '#run-btn')
    expect(page.locator('#banners')).to_contain_text('กรุณาวางตาราง WO Mapping ก่อนกด Run')
    expect(view_el(page, 'timesheet')).to_be_visible()
    setup_over_80(page)
    expect(view_el(page, 'results')).to_be_visible()


def empty_states_show_before_any_run(page):
    show(page, 'results')
    expect(page.locator('#results-empty')).to_be_visible()
    show(page, 'rebalance')
    expect(page.locator('#rebalance-empty')).to_be_visible()
```

และเพิ่มใน `TESTS` เป็น 4 รายการแรกของลิสต์:

```python
    ('the first visit shows only the Timesheet tab', first_visit_shows_only_the_timesheet_tab),
    ('tabs follow the URL hash across a reload and the Back button', tabs_follow_the_hash_across_reload_and_back),
    ('a successful Run jumps to ผลลัพธ์; a Run error stays on Timesheet', run_success_jumps_to_results_but_errors_stay),
    ('ผลลัพธ์ and แก้เกิน 80% show an empty state before any Run', empty_states_show_before_any_run),
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `node tests/all.js` → Expected: `FAIL - missing element ids: rebalance-badge, ...`
Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py` → Expected: 4 test ใหม่ `FAIL` ส่วนอีก 52 ผ่าน

- [ ] **Step 3: `<head>`** แทน

```html
<meta charset="UTF-8">
<title>WO Timesheet Summary</title>
```

ด้วย

```html
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>WO Timesheet Summary</title>
```

- [ ] **Step 4: markup ใหม่** แทนทุกอย่างตั้งแต่บรรทัด `<header class="page-head">` จนถึง `</section>` ที่ปิดการ์ด `#changelog-card` (ก่อนบรรทัด `<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/...">`) ด้วย:

```html
<header class="app-bar">
  <div class="app-bar-inner">
    <div class="brand">
      <h1>WO Timesheet Summary</h1>
      <p class="subtitle">แยก Work Order เป็น CAPEX / OPEX / Non Charge อัตโนมัติ พร้อมสรุปและส่งออกได้ทันที</p>
    </div>
    <nav class="tabs" aria-label="เมนูหลัก">
      <a href="#timesheet" data-view-link="timesheet"><span class="tab-num">1</span>Timesheet</a>
      <a href="#results" data-view-link="results"><span class="tab-num">2</span>ผลลัพธ์</a>
      <a href="#rebalance" data-view-link="rebalance"><span class="tab-num">3</span>แก้เกิน 80%<span id="rebalance-badge" class="tab-badge" hidden></span></a>
      <a href="#settings" data-view-link="settings" class="tab-settings">⚙ ตั้งค่า</a>
    </nav>
  </div>
</header>

<main class="page">
<div id="banners"></div>

<section class="view" data-view="timesheet">
  <div id="timesheet-rebalance-strip" class="banner warn strip" hidden></div>
  <section class="card">
    <div class="card-head"><h2>Timesheet Input</h2></div>
    <p class="card-desc">อัปโหลดไฟล์ .xlsx ที่มีโครงสร้างเดียวกับ krungsri.xlsx หรือพิมพ์ / วางข้อมูลลงตารางทีละช่อง (เลื่อนดูขวาได้ถึง Day31)</p>
    <label id="xlsx-dropzone" class="dropzone">
      <input type="file" id="xlsx-upload" accept=".xlsx" hidden>
      <span class="dropzone-icon" aria-hidden="true">📄</span>
      <span class="dropzone-text"><strong>ลากไฟล์ .xlsx มาวางตรงนี้</strong> หรือ คลิกเพื่อเลือกไฟล์</span>
      <span id="upload-status" class="status-text"></span>
    </label>
    <div id="timesheet-grid"></div>
    <button id="timesheet-add-row-btn" class="btn btn-add-row" type="button">+ เพิ่มแถว</button>
    <textarea id="timesheet-input" hidden></textarea>
    <div class="row">
      <label class="status-text" for="working-days-input">วันทำงานเดือนนี้:</label>
      <input id="working-days-input" type="number" min="1" max="31" step="1">
      <span id="working-days-hint" class="status-text"></span>
    </div>
  </section>
  <div class="run-row">
    <button id="run-btn" class="btn btn-primary" type="button">&#9654; Run</button>
    <span class="status-text">กด Run แล้วระบบจะพาไปหน้าผลลัพธ์</span>
  </div>
</section>

<section class="view" data-view="results" hidden>
  <div id="results-empty" class="empty-state">ยังไม่มีผลลัพธ์ — ไปที่แท็บ <a href="#timesheet">Timesheet</a> แล้วกด Run</div>
  <div id="kpi-tiles" class="kpi-tiles" hidden></div>
  <div id="results-over-banner" class="banner error" hidden></div>

  <section class="card">
    <div class="card-head"><h2>Table 2 &middot; % CAPEX / OPEX per Squad</h2></div>
    <div class="table-actions">
      <button id="copy-table2-btn" class="btn" type="button">Copy</button>
      <button id="download-table2-btn" class="btn" type="button">Download CSV</button>
    </div>
    <div id="table2-container" class="table-scroll"></div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Table 1 &middot; Squad &times; WO (CAPEX / OPEX / Non Charge) &mdash; หน่วย: Man-Day</h2></div>
    <div class="table-actions">
      <button id="copy-table1-btn" class="btn" type="button">Copy</button>
      <button id="download-table1-btn" class="btn" type="button">Download CSV</button>
    </div>
    <div id="table1-container" class="table-scroll"></div>
    <p class="card-desc" style="margin-top: 12px;">"Remaining (เดือนที่แล้ว)" พิมพ์เองได้ (จำไว้ให้) ส่วน "Remaining (เดือนนี้)" คำนวณอัตโนมัติ = เดือนที่แล้ว − ที่ทำได้เดือนนี้ พอจะเริ่มเดือนถัดไป กดปุ่มด้านล่างเพื่อเลื่อนยอดคงเหลือ</p>
    <div class="row">
      <button id="new-month-btn" class="btn" type="button">&#8635; ขึ้นเดือนใหม่</button>
      <span id="new-month-status" class="status-text"></span>
    </div>
  </section>
</section>

<section class="view" data-view="rebalance" hidden>
  <div id="rebalance-empty" class="empty-state">ไม่มี squad ที่ OPEX เกิน 80% 🎉</div>
  <section class="card" id="rebalance-card" hidden>
    <div class="card-head"><h2>Rebalance &middot; ลด OPEX ให้ไม่เกิน 80%</h2></div>
    <div id="rebalance-container"></div>
  </section>
  <section class="card" id="changelog-card" hidden>
    <div class="card-head"><h2>ประวัติการแก้ไข Timesheet</h2></div>
    <div class="table-actions">
      <button id="copy-changelog-btn" class="btn" type="button">Copy</button>
      <button id="download-changelog-btn" class="btn" type="button">Download CSV</button>
    </div>
    <div id="changelog-container" class="table-scroll"></div>
  </section>
</section>

<section class="view" data-view="settings" hidden>
  <section class="card">
    <div class="card-head"><h2>WO Mapping</h2></div>
    <p class="card-desc">พิมพ์หรือวาง (paste) ตาราง WO No. / Category / WO Name ทีละช่อง — วางข้อมูลก้อนใหญ่จาก Excel ลงในช่องแรกได้เลย มันจะกระจายลงทุกช่องให้อัตโนมัติเหมือนใน Excel</p>
    <div id="mapping-grid"></div>
    <button id="mapping-add-row-btn" class="btn btn-add-row" type="button">+ เพิ่มแถว</button>
    <textarea id="mapping-input" hidden></textarea>
    <div class="row">
      <button id="clear-mapping-btn" class="btn" type="button">Clear</button>
      <button id="mapping-reset-btn" class="btn" type="button">คืนค่าเริ่มต้น</button>
      <span id="mapping-status" class="status-text"></span>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>Role Ceilings</h2></div>
    <p class="card-desc">เพดาน Man-Day ต่อคนต่อเดือนของแต่ละตำแหน่ง (Z01-Z03 / CAPEX / OPEX) — ใช้เลือกว่าจะแก้ Timesheet ของใครเมื่อ squad มี OPEX เกิน 80% แก้ไขได้และระบบจำให้ เพดานจริง = ค่าในตาราง × วันทำงาน ÷ 20 (วันทำงานตั้งได้ในแท็บ Timesheet)</p>
    <div id="role-ceilings-grid"></div>
    <button id="role-ceilings-add-row-btn" class="btn btn-add-row" type="button">+ เพิ่มแถว</button>
    <div class="row">
      <button id="role-ceilings-reset-btn" class="btn" type="button">คืนค่าเริ่มต้น</button>
    </div>
  </section>

  <section class="card">
    <div class="card-head"><h2>People &rarr; Role</h2></div>
    <p class="card-desc">ใส่ชื่อ (ตรงกับ Name-Surname ใน Timesheet) และตำแหน่งของแต่ละคน — วางจาก Excel ได้ ระบบจำให้ เดือนถัดไปไม่ต้องกรอกใหม่ คนที่ยังไม่มีตำแหน่งจะไม่ถูกเลือกมาแก้</p>
    <div id="people-roles-grid"></div>
    <button id="people-roles-add-row-btn" class="btn btn-add-row" type="button">+ เพิ่มแถว</button>
    <div class="row">
      <button id="people-roles-reset-btn" class="btn" type="button">คืนค่าเริ่มต้น</button>
    </div>
    <datalist id="role-options"></datalist>
  </section>
</section>
</main>
```

- [ ] **Step 5: CSS โครงหน้า** ใน `<style>`:

(a) แทนกฎ `body { ... }` เดิม (มี `max-width: 880px;`) และกฎ `header.page-head { margin-bottom: 28px; }` ด้วย:

```css
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    background: var(--bg);
    color: var(--text);
    margin: 0;
    padding: 0 0 64px;
    line-height: 1.5;
  }
  .app-bar { position: sticky; top: 0; z-index: 10; background: var(--surface); border-bottom: 1px solid var(--border); box-shadow: 0 1px 2px rgba(20,24,34,.05); }
  .app-bar-inner, main.page { max-width: 1180px; margin: 0 auto; padding-left: 24px; padding-right: 24px; }
  .app-bar-inner { padding-top: 16px; }
  main.page { padding-top: 24px; }
  nav.tabs { display: flex; gap: 4px; margin-top: 10px; overflow-x: auto; }
  nav.tabs a { display: inline-flex; align-items: center; gap: 8px; padding: 10px 14px; color: var(--text-muted); text-decoration: none; font-weight: 600; font-size: .92rem; border-bottom: 3px solid transparent; white-space: nowrap; }
  nav.tabs a:hover { color: var(--text); }
  nav.tabs a.active { color: var(--accent); border-bottom-color: var(--accent); }
  nav.tabs a.tab-settings { margin-left: auto; }
  .tab-num { width: 22px; height: 22px; border-radius: 50%; background: var(--surface-alt); border: 1px solid var(--border); font-size: .75rem; display: inline-flex; align-items: center; justify-content: center; }
  nav.tabs a.active .tab-num { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast); }
  .tab-badge { min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: var(--error-text); color: var(--surface); font-size: .72rem; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; }
  .empty-state { padding: 48px 24px; text-align: center; color: var(--text-muted); background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius); margin-bottom: 20px; }
  .empty-state a { color: var(--accent); font-weight: 600; }
```

(b) ลบกฎ `.step-badge { ... }` ทั้งก้อน (ไม่มีที่ใช้แล้ว)

(c) แทนกฎ `.run-row { margin: 4px 0 6px; }` ด้วย `.run-row { display: flex; align-items: center; gap: 14px; margin: 4px 0 6px; }`

- [ ] **Step 6: router** ใน UI IIFE วางก่อน comment `// Restored rebalance (after a reload): ...` ใกล้ท้ายไฟล์:

```js
  // -- Views (tabs) -----------------------------------------------------------
  // One view visible at a time, picked by location.hash — so a reload keeps
  // the tab and the browser's Back button moves between tabs.
  const VIEWS = ['timesheet', 'results', 'rebalance', 'settings'];
  const viewEls = Array.from(document.querySelectorAll('section.view'));
  const viewLinks = Array.from(document.querySelectorAll('[data-view-link]'));
  function currentViewFromHash() {
    const name = location.hash.replace(/^#/, '');
    return VIEWS.indexOf(name) >= 0 ? name : 'timesheet';
  }
  function showView(name) {
    viewEls.forEach(el => { el.hidden = el.dataset.view !== name; });
    viewLinks.forEach(a => {
      const on = a.dataset.viewLink === name;
      a.classList.toggle('active', on);
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  }
  function goToView(name) {
    if (location.hash !== '#' + name) location.hash = name;
    showView(name);
  }
  window.addEventListener('hashchange', () => showView(currentViewFromHash()));
  showView(currentViewFromHash());
```

- [ ] **Step 7: Run แล้วเด้งไปผลลัพธ์** แทนบรรทัด

```js
  runBtn.addEventListener('click', () => refresh({ replan: true }));
```

ด้วย

```js
  // A Run that built the tables goes to the results tab; one that stopped on
  // an error stays put (the error banner is visible on every tab).
  runBtn.addEventListener('click', () => {
    refresh({ replan: true });
    if (lastTable2) goToView('results');
  });
```

- [ ] **Step 8: รัน test ทั้งหมดต้องผ่าน**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 56 browser tests passed`

- [ ] **Step 9: Commit**

```bash
git add index.html tests/check-structure.js tests/browser_e2e.py
git commit -m "feat: split the page into Timesheet / ผลลัพธ์ / แก้เกิน 80% / ตั้งค่า tabs with a hash router

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: `renderStatus()` — KPI, แถบเตือน, badge, empty state, แถบสถานะหลัง Apply

**Files:**
- Modify: `index.html` (CSS, UI IIFE: การหา element, `refresh`, handler อัปโหลด, handler ขึ้นเดือนใหม่, startup)
- Test: `tests/browser_e2e.py`

**Interfaces:**
- Consumes: `summaryKpis` (Task 1), element ใหม่จาก Task 3, `lastTable1`, `lastTable2`, `rebalanceState`, `rebalanceCard`, `diffTimesheets`, `timesheetGrid`, `formatMH`, `formatPct`, `escapeHtml`, `OPEX_PCT_ALERT_THRESHOLD`
- Produces: `renderStatus()`, `kpiTileHtml(label, value, alert)`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** ใน `tests/browser_e2e.py` วางต่อจาก `def empty_states_show_before_any_run` (Task 3):

```python
def results_show_kpis_and_a_link_to_fix_over_80(page):
    setup_over_80(page)  # S1: CAPEX 2.00 MD, OPEX 9.00 MD -> 81.82%
    reveal(page, '#results-empty')
    expect(page.locator('#results-empty')).to_be_hidden()
    tiles = page.locator('#kpi-tiles .kpi')
    expect(tiles).to_have_count(4)
    expect(tiles.nth(0).locator('.kpi-value')).to_have_text('1')
    expect(tiles.nth(1).locator('.kpi-value')).to_have_text('1')
    expect(tiles.nth(1)).to_have_class(re.compile('kpi-alert'))
    expect(tiles.nth(2).locator('.kpi-value')).to_have_text('11.00')
    expect(tiles.nth(3).locator('.kpi-value')).to_have_text('81.82%')
    expect(page.locator('#results-over-banner')).to_contain_text('มี 1 squad ที่ OPEX เกิน 80%: S1')
    expect(page.locator('#rebalance-badge')).to_have_text('1')
    click(page, '#results-over-banner a[href="#rebalance"]')
    expect(view_el(page, 'rebalance')).to_be_visible()
    expect(page.locator('#rebalance-empty')).to_be_hidden()


def badge_and_banner_clear_once_nothing_is_over_80(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    expect(page.locator('#rebalance-badge')).to_be_hidden()
    reveal(page, '#results-over-banner')
    expect(page.locator('#results-over-banner')).to_be_hidden()
    expect(page.locator('#kpi-tiles .kpi').nth(1)).not_to_have_class(re.compile('kpi-alert'))


def no_squad_over_80_shows_the_rebalance_empty_state(page):
    setup(page, MAPPING, [timesheet_row('Ann', 'S1', 'C1', {1: 8})])
    show(page, 'rebalance')
    expect(page.locator('#rebalance-empty')).to_be_visible()
    expect(page.locator('#rebalance-card')).to_be_hidden()


def timesheet_strip_counts_changed_cells_after_apply(page):
    setup_over_80(page)
    reveal(page, '#timesheet-rebalance-strip')
    expect(page.locator('#timesheet-rebalance-strip')).to_be_hidden()
    click(page, '[data-rb-action="apply"]')
    show(page, 'timesheet')
    strip = page.locator('#timesheet-rebalance-strip')
    expect(strip).to_be_visible()
    expect(strip).to_contain_text('ช่องที่เปลี่ยน 2 ช่อง')
    click(page, '[data-rb-action="undo"]')
    show(page, 'timesheet')
    expect(strip).to_be_hidden()
```

เพิ่มใน `TESTS` ต่อจาก 4 รายการของ Task 3:

```python
    ('ผลลัพธ์ shows 4 KPI tiles, an over-80% banner and a ไปแก้ link to tab 3', results_show_kpis_and_a_link_to_fix_over_80),
    ('the badge and banner clear once no squad is over 80%', badge_and_banner_clear_once_nothing_is_over_80),
    ('แก้เกิน 80% shows its empty state when no squad is over', no_squad_over_80_shows_the_rebalance_empty_state),
    ('after Apply the Timesheet tab says how many cells changed, gone after Undo', timesheet_strip_counts_changed_cells_after_apply),
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: 4 test ใหม่ `FAIL` ส่วนอีก 56 ผ่าน

- [ ] **Step 3: หา element** ใน UI IIFE ต่อจากบรรทัด `const rebalanceCard = document.getElementById('rebalance-card');` เพิ่ม:

```js
  const rebalanceBadge = document.getElementById('rebalance-badge');
  const resultsEmpty = document.getElementById('results-empty');
  const kpiTiles = document.getElementById('kpi-tiles');
  const resultsOverBanner = document.getElementById('results-over-banner');
  const rebalanceEmpty = document.getElementById('rebalance-empty');
  const timesheetStrip = document.getElementById('timesheet-rebalance-strip');
```

- [ ] **Step 4: `renderStatus`** วางต่อจาก `function refresh(opts) { ... }` แล้วแก้ `refresh` ให้เรียกตอนท้าย:

```js
  function refresh(opts) {
    renderTablesAndRebalance(!!(opts && opts.replan));
    renderChangeLog();
    markChangedCells();
    renderStatus();
  }

  // Everything that reflects "where things stand" outside the tables: the
  // KPI tiles and over-80% banner on ผลลัพธ์, the tab badge, both empty
  // states, and the Timesheet tab's "already edited" strip.
  function renderStatus() {
    const k = lastTable1 && lastTable2 ? summaryKpis(lastTable1, lastTable2, OPEX_PCT_ALERT_THRESHOLD) : null;
    const over = k ? k.overSquads : [];
    resultsEmpty.hidden = !!k;
    kpiTiles.hidden = !k;
    kpiTiles.innerHTML = k
      ? kpiTileHtml('Squad', String(k.squads), false) +
        kpiTileHtml('เกิน 80%', String(over.length), over.length > 0) +
        kpiTileHtml('Man-Day รวม', formatMH(k.totalMD), false) +
        kpiTileHtml('OPEX รวม', formatPct(k.opexPct), k.opexPct != null && k.opexPct > OPEX_PCT_ALERT_THRESHOLD)
      : '';
    resultsOverBanner.hidden = over.length === 0;
    resultsOverBanner.innerHTML = over.length
      ? 'มี ' + over.length + ' squad ที่ OPEX เกิน 80%: ' + over.map(escapeHtml).join(', ') + ' <a href="#rebalance">ไปแก้ →</a>'
      : '';
    rebalanceBadge.hidden = over.length === 0;
    rebalanceBadge.textContent = over.length ? String(over.length) : '';
    rebalanceEmpty.hidden = !rebalanceCard.hidden;
    const changed = rebalanceState ? diffTimesheets(rebalanceState.original, timesheetGrid.getRows(), rebalanceState.moves).rows.length : 0;
    timesheetStrip.hidden = !rebalanceState;
    timesheetStrip.innerHTML = rebalanceState
      ? 'แก้ Timesheet จากหน้าแก้เกิน 80% แล้ว — ช่องที่เปลี่ยน ' + changed + ' ช่อง (สีเหลือง) <a href="#rebalance">ไปหน้าแก้เกิน 80% →</a>'
      : '';
  }

  function kpiTileHtml(label, value, alert) {
    return '<div class="kpi' + (alert ? ' kpi-alert' : '') + '"><div class="kpi-label">' + escapeHtml(label) +
      '</div><div class="kpi-value">' + escapeHtml(value) + '</div></div>';
  }
```

- [ ] **Step 5: เรียก `renderStatus()` จุดอื่นที่สถานะเปลี่ยนโดยไม่ผ่าน `refresh`**

(a) handler อัปโหลด (`reader.onload`): ต่อจากบรรทัด `lastTable1 = lastTable2 = null;` เพิ่ม `renderStatus();`
(b) handler `newMonthBtn` (`click`): ก่อนบรรทัด `newMonthStatus.textContent = 'อัปเดตแล้ว — ...';` เพิ่ม `renderStatus();`
(c) startup ท้าย IIFE: ต่อจากบล็อก `if (rebalanceState) { try { renderRebalance(); renderChangeLog(); markChangedCells(); } catch (e) { /* ignore */ } }` เพิ่ม `renderStatus();`

- [ ] **Step 6: CSS** ต่อจากกฎ `.empty-state a { ... }` (Task 3) เพิ่ม:

```css
  .kpi-tiles { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 14px; margin-bottom: 18px; }
  .kpi { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); box-shadow: var(--shadow); padding: 14px 18px; }
  .kpi-label { color: var(--text-muted); font-size: .8rem; font-weight: 600; }
  .kpi-value { font-size: 1.6rem; font-weight: 700; font-variant-numeric: tabular-nums; margin-top: 2px; }
  .kpi.kpi-alert { border-color: var(--error-border); background: var(--error-bg); }
  .kpi.kpi-alert .kpi-value { color: var(--error-text); }
  #results-over-banner, #timesheet-rebalance-strip { margin: 0 0 18px; }
  #results-over-banner a, #timesheet-rebalance-strip a { color: inherit; font-weight: 700; margin-left: 8px; }
  @media (max-width: 720px) { .kpi-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
```

- [ ] **Step 7: รัน test ทั้งหมดต้องผ่าน**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 60 browser tests passed`

- [ ] **Step 8: Commit**

```bash
git add index.html tests/browser_e2e.py
git commit -m "feat: KPI tiles, over-80% banner, tab badge, empty states and post-Apply strip

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: ลากไฟล์ .xlsx มาวาง (dropzone)

**Files:**
- Modify: `index.html` (CSS, UI IIFE: handler อัปโหลด)
- Test: `tests/browser_e2e.py`

**Interfaces:**
- Consumes: `#xlsx-dropzone` (Task 3), handler อัปโหลดเดิม (ซึ่ง Task 4 เพิ่ม `renderStatus();` ไว้แล้ว)
- Produces: `loadXlsxFile(file)`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** วางต่อจาก `def upload_non_xlsx_shows_error` ใน `tests/browser_e2e.py`:

```python
def dropping_a_file_on_the_dropzone_uses_the_upload_handler(page):
    show(page, 'timesheet')
    page.locator('#xlsx-dropzone').evaluate('''el => {
        const dt = new DataTransfer();
        dt.items.add(new File(['just some text'], 'notes.xlsx', { type: 'text/plain' }));
        el.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
    }''')
    expect(page.locator('#upload-status')).to_contain_text('ไฟล์นี้ดูไม่ใช่ไฟล์ Excel')


def dragging_over_the_dropzone_highlights_it(page):
    show(page, 'timesheet')
    dz = page.locator('#xlsx-dropzone')
    dz.evaluate("el => el.dispatchEvent(new DragEvent('dragover', { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true }))")
    expect(dz).to_have_class(re.compile('dragging'))
    dz.evaluate("el => el.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))")
    expect(dz).not_to_have_class(re.compile('dragging'))
```

เพิ่มใน `TESTS` ต่อจาก `('uploading a file that is not really .xlsx shows an error', upload_non_xlsx_shows_error),`:

```python
    ('dropping a file on the dropzone goes through the upload handler', dropping_a_file_on_the_dropzone_uses_the_upload_handler),
    ('dragging over the dropzone highlights it until the drag leaves', dragging_over_the_dropzone_highlights_it),
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: 2 test ใหม่ `FAIL` ส่วนอีก 60 ผ่าน

- [ ] **Step 3: แยก handler อัปโหลดออกเป็น `loadXlsxFile`** ใน UI IIFE handler เดิมหน้าตาแบบนี้:

```js
  xlsxUpload.addEventListener('change', () => {
    const file = xlsxUpload.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (evt) => {
      ... (ตัวเดิม ไม่ต้องแก้)
    };
    reader.onerror = () => {
      ...
    };
    // Reset so selecting the exact same file again still fires 'change'
    // (browsers skip the event when the input's value hasn't changed).
    xlsxUpload.value = '';
    reader.readAsArrayBuffer(file);
  });
```

ให้แทนบรรทัดแรก 3 บรรทัด (`xlsxUpload.addEventListener('change', () => {` / `const file = xlsxUpload.files[0];` / `if (!file) return;`) ด้วย:

```js
  // Shared by the file picker and drag-and-drop onto #xlsx-dropzone.
  function loadXlsxFile(file) {
```

และแทน 4 บรรทัดสุดท้าย (comment `// Reset so selecting ...` 2 บรรทัด, `xlsxUpload.value = '';`, `reader.readAsArrayBuffer(file);`) กับ `});` ปิด handler ด้วย:

```js
    reader.readAsArrayBuffer(file);
  }

  xlsxUpload.addEventListener('change', () => {
    const file = xlsxUpload.files[0];
    // Reset so selecting the exact same file again still fires 'change'
    // (browsers skip the event when the input's value hasn't changed).
    xlsxUpload.value = '';
    if (file) loadXlsxFile(file);
  });

  const xlsxDropzone = document.getElementById('xlsx-dropzone');
  xlsxDropzone.addEventListener('dragover', (e) => { e.preventDefault(); xlsxDropzone.classList.add('dragging'); });
  xlsxDropzone.addEventListener('dragleave', () => xlsxDropzone.classList.remove('dragging'));
  xlsxDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    xlsxDropzone.classList.remove('dragging');
    const file = e.dataTransfer && e.dataTransfer.files[0];
    if (file) loadXlsxFile(file);
  });
```

(ทุกอย่างใน `reader.onload` / `reader.onerror` ต้องเหมือนเดิมทุกตัวอักษร)

- [ ] **Step 4: CSS** ต่อจากกฎ `@media (max-width: 720px) { .kpi-tiles ... }` (Task 4) เพิ่ม:

```css
  .dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; padding: 22px; margin-bottom: 14px; border: 2px dashed var(--border); border-radius: var(--radius); background: var(--surface-alt); color: var(--text-muted); text-align: center; cursor: pointer; transition: border-color .15s, background .15s; }
  .dropzone:hover, .dropzone.dragging { border-color: var(--accent); background: color-mix(in srgb, var(--accent) 8%, var(--surface)); color: var(--text); }
  .dropzone-icon { font-size: 1.6rem; line-height: 1; }
  .dropzone #upload-status { margin-top: 4px; }
```

- [ ] **Step 5: รัน test ทั้งหมดต้องผ่าน**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 62 browser tests passed`

- [ ] **Step 6: Commit**

```bash
git add index.html tests/browser_e2e.py
git commit -m "feat: drag-and-drop .xlsx onto the Timesheet dropzone

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: หน้าตา — ฟอนต์, สีหมวด, ตาราง, การ์ด

**Files:**
- Modify: `index.html` (`<head>`, CSS, `renderTable1`, `renderTable2`)
- Test: `tests/browser_e2e.py`

**Interfaces:**
- Consumes: markup จาก Task 3
- Produces: class `cat-capex` / `cat-opex` / `cat-noncharge` / `cat-unmapped` บนหัวตาราง และ token สี `--capex-bg` ... `--unmapped-text`

- [ ] **Step 1: เขียน test ที่ยังไม่ผ่าน** ใน `tests/browser_e2e.py` วางต่อจาก `def run_builds_tables_and_flags_high_opex`:

```python
def result_headers_carry_category_colours_and_the_thai_font_loads(page):
    setup_over_80(page)
    band = page.locator('#table1-container thead tr').first
    expect(band.locator('th.cat-capex')).to_have_text('CAPEX')
    expect(band.locator('th.cat-opex')).to_have_text('OPEX')
    expect(page.locator('#table2-container thead th.cat-capex')).to_have_text('CAPEX %')
    expect(page.locator('#table2-container thead th.cat-opex')).to_have_text('OPEX %')
    font = page.evaluate('getComputedStyle(document.body).fontFamily')
    assert font.startswith('"IBM Plex Sans Thai"'), font
```

เพิ่มใน `TESTS` ต่อจาก `('Run builds Table 1/2 and flags a squad over 80% OPEX', run_builds_tables_and_flags_high_opex),`:

```python
    ('result headers carry category colour classes and the Thai font is set', result_headers_carry_category_colours_and_the_thai_font_loads),
```

- [ ] **Step 2: รัน test ต้องไม่ผ่าน**

Run: `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: test ใหม่ `FAIL` ส่วนอีก 62 ผ่าน

- [ ] **Step 3: ฟอนต์** ใน `<head>` ต่อจากบรรทัด `<title>WO Timesheet Summary</title>` เพิ่ม:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Thai:wght@400;500;600;700&display=swap" rel="stylesheet">
```

ใน CSS กฎ `body { ... }` แทนบรรทัด `font-family: system-ui, -apple-system, "Segoe UI", sans-serif;` ด้วย `font-family: "IBM Plex Sans Thai", system-ui, -apple-system, "Segoe UI", sans-serif;`

- [ ] **Step 4: token สีหมวด** ใน `:root { ... }` (โหมดสว่าง) ต่อจากบรรทัด `--error-bg: ...;` เพิ่ม:

```css
    --capex-bg: #e3f5e9; --capex-text: #1e6b3a;
    --opex-bg: #e3edfc; --opex-text: #1f4f9c;
    --noncharge-bg: #fdf3d7; --noncharge-text: #7a5a00;
    --unmapped-bg: #fbe4e4; --unmapped-text: #8a2a22;
```

และใน `@media (prefers-color-scheme: dark) { :root { ... } }` ต่อจากบรรทัด `--error-bg: ...;` เพิ่ม:

```css
      --capex-bg: #16301f; --capex-text: #8fd6a6;
      --opex-bg: #172640; --opex-text: #9cbcf5;
      --noncharge-bg: #33290f; --noncharge-text: #f0cf75;
      --unmapped-bg: #3a1d1b; --unmapped-text: #f4a89d;
```

แก้ `--radius: 12px;` เป็น `--radius: 14px;` และในกฎ `.card { ... }` แก้ `padding: 20px 22px;` เป็น `padding: 22px 24px;`

- [ ] **Step 5: CSS ตาราง** ต่อจากกฎ `.dropzone #upload-status { ... }` (Task 5) เพิ่ม:

```css
  th.cat-capex { background: var(--capex-bg); color: var(--capex-text); }
  th.cat-opex { background: var(--opex-bg); color: var(--opex-text); }
  th.cat-noncharge { background: var(--noncharge-bg); color: var(--noncharge-text); }
  th.cat-unmapped { background: var(--unmapped-bg); color: var(--unmapped-text); }
  .table-scroll tbody tr:nth-child(even):not(.summary-row):not(.remaining-row) { background: color-mix(in srgb, var(--surface-alt) 70%, transparent); }
  #table1-container, #table2-container, #changelog-container { max-height: 70vh; overflow: auto; }
  #table1-container thead, #table2-container thead, #changelog-container thead { position: sticky; top: 0; z-index: 1; }
```

- [ ] **Step 6: class หมวดบนหัวตาราง**

(a) ใน `renderTable1` แทนบรรทัด

```js
    groups.forEach(g => { html += '<th colspan="' + g.span + '">' + CATEGORY_LABEL[g.category] + '</th>'; });
```

ด้วย

```js
    groups.forEach(g => { html += '<th colspan="' + g.span + '" class="cat-' + g.category.toLowerCase().replace('_', '') + '">' + CATEGORY_LABEL[g.category] + '</th>'; });
```

(b) ใน `renderTable2` แทน `'<table><thead><tr><th>Squad</th><th>CAPEX %</th><th>OPEX %</th>'` ด้วย `'<table><thead><tr><th>Squad</th><th class="cat-capex">CAPEX %</th><th class="cat-opex">OPEX %</th>'`

- [ ] **Step 7: รัน test ทั้งหมดต้องผ่าน**

Run: `node tests/all.js` แล้วตามด้วย `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py`
Expected: `ALL TEST FILES PASSED` และ `all 63 browser tests passed`

- [ ] **Step 8: Commit**

```bash
git add index.html tests/browser_e2e.py
git commit -m "style: IBM Plex Sans Thai, category colours on result headers, zebra rows, sticky result headers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: ตรวจรอบสุดท้าย

- [ ] **Step 1:** `node tests/all.js` และ `PYTHONIOENCODING=utf-8 python tests/browser_e2e.py` → `ALL TEST FILES PASSED` และ `all 63 browser tests passed`
- [ ] **Step 2:** แคปหน้าจอทั้ง 4 แท็บ (กว้าง 1280px และ 420px สำหรับจอแคบ) ทั้งโหมดสว่างและมืด (`page.emulate_media(color_scheme='dark')`) ด้วยสคริปต์ Playwright ใน scratchpad ที่ใช้ `setup_over_80` แล้วดูว่า: แท็บไม่ล้น, KPI อ่านง่าย, สีหมวดอ่านออกทั้งสองโหมด, ไม่มีหน้าที่ไม่มี scroll แนวนอนโดยไม่ตั้งใจ
- [ ] **Step 3:** ทวนกับ spec ทีละหัวข้อ แล้วชี้ว่าแต่ละข้ออยู่ใน test ข้อไหน
- [ ] **Step 4:** ถาม user ก่อน merge เข้า `master` และก่อน push
