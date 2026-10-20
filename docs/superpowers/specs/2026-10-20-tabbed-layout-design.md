# Design: แยกหน้าเป็นแท็บ + ปรับหน้าตา

วันที่: 2026-10-20 · สถานะ: อนุมัติโครงแล้ว (ในแชท)

## เป้าหมาย

หน้าเดียวยาวประมาณ 3,500 px ที่มีการ์ด 9 ใบเรียงกันดูรกเกินไป ให้แยกเป็น 4 แท็บตามความถี่ที่ใช้ และปรับหน้าตาให้ดูดีขึ้น โดยไม่เปลี่ยนการคำนวณ ข้อมูลที่บันทึกไว้ หรือปุ่มเดิมใด ๆ

user บอกว่าทุกเดือนใช้แค่ Timesheet + Run + ดูผล และแก้เมื่อเกิน 80% ส่วน WO Mapping / Role Ceilings / People → Role นาน ๆ แตะที

## โครงหน้า

```
┌───────────────────────────────────────────────────────────────┐
│  WO Timesheet Summary                                          │
│  [1 Timesheet]  [2 ผลลัพธ์]  [3 แก้เกิน 80% ●2]    [⚙ ตั้งค่า] │
├───────────────────────────────────────────────────────────────┤
│  #banners (ข้อความเตือน/error ของ Run — โชว์ทุกแท็บ)            │
│  <view ที่เลือกอยู่>                                             │
└───────────────────────────────────────────────────────────────┘
```

| แท็บ (`data-view`) | เนื้อหา (ย้าย element เดิมทั้งก้อน id ไม่เปลี่ยน) |
|---|---|
| `timesheet` "1 Timesheet" | แถบสถานะหลัง Apply (`#timesheet-rebalance-strip`) · การ์ด Timesheet Input: dropzone (`#xlsx-dropzone` ครอบ `#xlsx-upload` + `#upload-status`), `#timesheet-grid`, `#timesheet-add-row-btn`, วันทำงานเดือนนี้ (`#working-days-input`, `#working-days-hint` ย้ายมาจากการ์ด Role Ceilings) · `#run-btn` |
| `results` "2 ผลลัพธ์" | ตัวเลขสรุป (`#kpi-tiles`) · แถบเตือนเมื่อมี squad เกิน 80% พร้อมลิงก์ไปแท็บ 3 (`#results-over-banner`) · การ์ด Table 2 · การ์ด Table 1 (รวม Remaining + ขึ้นเดือนใหม่) · ถ้ายังไม่ได้ Run ให้โชว์ `#results-empty` "ยังไม่มีผลลัพธ์ — ไปที่แท็บ Timesheet แล้วกด Run" |
| `rebalance` "3 แก้เกิน 80%" | `#rebalance-card` · `#changelog-card` · ถ้าการ์ด Rebalance ซ่อนอยู่ (ไม่มี squad เกินและยังไม่ได้ Apply) ให้โชว์ `#rebalance-empty` "ไม่มี squad ที่ OPEX เกิน 80% 🎉" |
| `settings` "⚙ ตั้งค่า" | การ์ด WO Mapping · การ์ด Role Ceilings · การ์ด People → Role (`datalist#role-options` ไปด้วย) |

ลำดับการ์ดใน results คือ Table 2 ก่อน Table 1 เพราะ Table 2 ใช้ตัดสินว่าต้องแก้ไหม

## การเปลี่ยนแท็บ (router)

- nav เป็นลิงก์ `<a href="#timesheet" data-view-link="timesheet">` ทั้ง 4 อัน แท็บที่เลือกอยู่ได้ `aria-current="page"` และ class `active`
- view แต่ละอันคือ `<section class="view" data-view="...">` ใช้ `hidden` ซ่อน view ที่ไม่ได้เลือก ให้เห็นทีละ view
- ฟังก์ชัน `showView(name)` ซ่อน/โชว์ view และอัปเดต nav ส่วน `currentViewFromHash()` คืนชื่อ view จาก `location.hash` (ไม่รู้จัก/ว่าง → `timesheet`)
- ฟัง `hashchange` → `showView(currentViewFromHash())` ตอนเปิดหน้าเรียกครั้งหนึ่ง จึงรีโหลดแล้วยังอยู่แท็บเดิม และปุ่ม Back ของเบราว์เซอร์ใช้ได้
- `goToView(name)` = `location.hash = name` (ถ้าเท่ากับ hash เดิมให้เรียก `showView` ตรง ๆ)
- กด Run แล้ว**สร้างตารางได้** (ไม่ได้ return ตอนเจอ error) → `goToView('results')` ถ้า Run เจอ error (ไม่มี mapping / ไม่มี timesheet / ไม่มีแถวที่ใช้ได้) อยู่แท็บเดิม และ error โชว์ใน `#banners` ซึ่งเห็นทุกแท็บ
- การคำนวณอัตโนมัติหลัง Apply (`refresh({ replan: false })`) และ Apply / Undo **ไม่เปลี่ยนแท็บ**

## ตัวเลขบนแท็บ และแถบเตือน

- `#rebalance-badge` (ใน nav ของแท็บ 3) แสดงจำนวน squad ที่ OPEX > 80% จาก Table 2 ล่าสุด ถ้า 0 หรือยังไม่ได้ Run ให้ซ่อน
- `#results-over-banner`: ถ้ามี squad เกิน แสดง `มี <n> squad ที่ OPEX เกิน 80%: <S1, S2>` + ปุ่ม `ไปแก้ →` (`<a href="#rebalance">`) ถ้าไม่มีให้ซ่อน
- `#timesheet-rebalance-strip`: โชว์เมื่อ `rebalanceState` มีค่า ข้อความ `แก้ Timesheet จากหน้าแก้เกิน 80% แล้ว — ช่องที่เปลี่ยน <n> ช่อง (สีเหลือง)` + ลิงก์ `ไปหน้าแก้เกิน 80% →` โดย n = จำนวนแถวของ `diffTimesheets` ถ้าไม่มี `rebalanceState` ให้ซ่อน
- อัปเดตทั้งสามจุดในฟังก์ชันเดียว `renderStatus()` เรียกท้าย `refresh()` และตอนเปิดหน้า

## ตัวเลขสรุป (KPI)

ฟังก์ชันล้วนใหม่ในส่วน logic: `summaryKpis(table1, table2, threshold)` คืน

```js
{ squads: number, overSquads: string[], totalMD: number, opexPct: number | null }
```

- `squads` = จำนวนแถวใน table2
- `overSquads` = squad ที่ `opexPct > threshold` เรียงตาม table2
- `totalMD` = `table1.grandTotal`
- `opexPct` = ผลรวม `colTotals` ของคอลัมน์ OPEX ÷ (ผลรวม CAPEX + OPEX) ถ้าตัวหารเป็น 0 ได้ `null`

`#kpi-tiles` แสดง 4 กล่อง: `Squad` · `เกิน 80%` (สีแดงถ้า > 0) · `Man-Day รวม` (`formatMH`) · `OPEX รวม` (`formatPct`, สีแดงถ้าเกิน threshold)

## อัปโหลดแบบลากวาง

- `#xlsx-dropzone` เป็นกล่องเส้นประ ข้อความ "ลากไฟล์ .xlsx มาวางตรงนี้ หรือ คลิกเพื่อเลือกไฟล์" คลิกที่ไหนในกล่องก็เปิดตัวเลือกไฟล์ (เป็น `<label>` ครอบ input)
- `dragover` → `preventDefault` + class `dragging` · `dragleave` / `drop` → ลบ class
- `drop` → ไฟล์แรกใน `dataTransfer.files` ถูกส่งเข้า `loadXlsxFile(file)` ซึ่งเป็นตัวเดียวกับที่ `change` ของ `#xlsx-upload` ใช้ (แยก handler เดิมออกมาเป็นฟังก์ชันนี้ ไม่เปลี่ยนพฤติกรรม)

## หน้าตา

- `<meta name="viewport" content="width=device-width, initial-scale=1">` และฟอนต์ **IBM Plex Sans Thai** (Google Fonts, น้ำหนัก 400/500/600/700) โดยมี `system-ui` เป็นตัวสำรอง
- ความกว้างหน้า `max-width: 1180px` (เดิม 880px) เพราะตารางกว้าง
- แถบหัว (`header.app-bar`) ติดด้านบนตอนเลื่อน (`position: sticky`) พื้นหลังสีเดียวกับ surface มีเส้นล่าง ส่วน nav ใช้ปุ่มแท็บที่มีเส้นใต้ `var(--accent)` 3px ตอน active
- ใช้ token สีเดิม แล้วเพิ่ม `--capex` / `--opex` / `--noncharge` (พื้นอ่อน + ตัวหนังสือเข้ม ทั้งโหมดสว่างและมืด) สำหรับป้ายหมวด
- หัวกลุ่มหมวดใน Table 1 (`<th colspan>`) และหัวคอลัมน์ CAPEX % / OPEX % ใน Table 2 ได้ class `cat-capex` / `cat-opex` / `cat-noncharge` / `cat-unmapped`
- ตารางผลลัพธ์: แถวสลับสี (`tbody tr:nth-child(even)`) และ `.table-scroll` ของผลลัพธ์มี `max-height: 70vh; overflow: auto;` กับ `thead th { position: sticky; top: 0; }` เพื่อให้หัวตารางติดตอนเลื่อน
- การ์ด: radius 14px, padding 22px 24px, เงาเดิม
- dark mode: token ใหม่ทุกตัวมีค่าใน `@media (prefers-color-scheme: dark)` ด้วย

## สิ่งที่ไม่เปลี่ยน

ส่วน logic ทั้งหมด (ยกเว้นเพิ่ม `summaryKpis`), localStorage key ทั้งหมด, id ของ element เดิมทุกตัว (`tests/check-structure.js` ต้องผ่าน), ปุ่ม Copy / Download / Undo / ขึ้นเดือนใหม่ และพฤติกรรมของ Rebalance (ร่าง, Apply, คำนวณอัตโนมัติ, สีของช่อง, ประวัติ)

## การ test

**Node**: `summaryKpis` (ปกติ, ไม่มี squad เกิน, ไม่มีคอลัมน์ CAPEX/OPEX → `opexPct: null`, เท่ากับ 80% พอดีไม่นับว่าเกิน)

**Browser**: test เดิมทั้ง 52 ข้อต้องยังผ่าน ทุกการคลิก / พิมพ์ / เลือก และทุกการเช็ก "มองเห็น / ซ่อน" ต้องเปิดแท็บของ element นั้นก่อน (ผ่าน helper) ส่วน test ใหม่:
- เปิดหน้ามาเจอแท็บ Timesheet และเห็นแค่ view เดียว
- คลิกแท็บแล้ว hash เปลี่ยน รีโหลดแล้วยังอยู่แท็บเดิม และ Back กลับแท็บก่อนหน้าได้
- Run สำเร็จแล้วเด้งไปแท็บผลลัพธ์ แต่ Run ที่เจอ error ยังอยู่แท็บ Timesheet และเห็น error
- KPI tiles ถูกต้อง, แถบเตือนเกิน 80% กับลิงก์ "ไปแก้ →" พาไปแท็บ 3, badge บอกจำนวน และหายเมื่อแก้จนไม่เกินแล้ว
- แท็บ 3 ตอนไม่มี squad เกินโชว์ `#rebalance-empty` · แท็บผลลัพธ์ก่อน Run โชว์ `#results-empty`
- หลัง Apply แถบในแท็บ Timesheet บอกจำนวนช่องที่เปลี่ยนถูก และหายหลัง Undo
- ลากไฟล์มาวางใน dropzone ใช้ handler เดียวกับปุ่ม (ทดสอบด้วยไฟล์ที่ไม่ใช่ xlsx แล้วเห็น error ข้อความเดิม)

## นอกขอบเขต

แยกเป็นหลายไฟล์ HTML, เปลี่ยนสีหลัก/โลโก้, แก้ responsive ระดับมือถือเต็มรูปแบบ (แค่ให้ไม่พังที่จอแคบ)
