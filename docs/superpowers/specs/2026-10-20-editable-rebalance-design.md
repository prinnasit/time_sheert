# Design: แก้การ Rebalance ได้ในระบบ (ก่อนและหลัง Apply)

วันที่: 2026-10-20 · สถานะ: รอ review
ต่อยอดจาก: [2026-10-18-opex-rebalance-flow.md](2026-10-18-opex-rebalance-flow.md) (ตรรกะเลือกคนและจำนวนที่ย้าย ซึ่งไม่เปลี่ยน)

## เป้าหมาย

ตอนนี้ระบบเสนอคำแนะนำการย้าย OPEX → CAPEX แล้วให้กด Apply ได้อย่างเดียว ปรับได้แค่ CAPEX WO ปลายทาง หลัง Apply แก้ Timesheet เองได้ก็จริง แต่ตารางสรุปไม่อัปเดต และประวัติไม่บันทึกสิ่งที่แก้เอง

หลังทำงานนี้เสร็จ user ต้องทำได้ 2 อย่าง:

1. **ก่อน Apply**: แก้คำแนะนำได้ถึงระดับวัน คือแก้ ลบ หรือเพิ่มรายการย้ายได้ และเห็น % ที่จะได้ก่อนกด Apply
2. **หลัง Apply**: แก้ Timesheet ต่อจากที่ระบบย้ายให้ได้ ตารางทั้งหมดต้องอัปเดตเอง และประวัติต้องบอกว่าช่องไหน Rebalance เปลี่ยน ช่องไหนแก้เอง

## สิ่งที่ไม่เปลี่ยน

- `planRebalance` (ตรรกะรอบ 1 / รอบ 2, การเลือกคน, เพดาน) กับ `applyMoves`
- ปุ่ม Copy Timesheet ฉบับใหม่, Copy สรุป CAPEX/OPEX, ดาวน์โหลด .xlsx ทั้งสองฉบับ, Undo
- ก่อน Apply ครั้งแรก ตารางยังคำนวณเฉพาะตอนกด Run

## ส่วนที่ 1: ร่างการย้าย (ก่อน Apply)

### หน้าตา

ตารางร่างแทนที่ตารางคำแนะนำเดิมในการ์ด Rebalance (ตารางเดิมเป็น 1 แถวต่อคน และมี dropdown `rb-target`)

```
ชื่อ  | Squad | วัน    | MH   | จาก WO   | ไป CAPEX WO |
Dev1  | S1    | [11▾]  | [2]  | [O1 ▾]   | [C1 ▾]      | 🗑
Dev2  | S1    | [10▾]  | [1]  | [O1 ▾]   | [C1 ▾]      | 🗑   ⚠ วันที่ 10 ลง O1 ไว้ 0.5 MH
[+ เพิ่มการย้าย]   [↻ คำนวณคำแนะนำใหม่]   [ทำต่อ (รอบที่ 2)]  ← เฉพาะเมื่อมี squad สถานะ needs-continue

ถ้า Apply ตามนี้:
S1 | OPEX 81.82% → 79.55% ✓
[Apply]
```

### ข้อมูล: แถวร่าง (draft row)

```js
{ id, nameKey, name, sq, day /* 1–31 */, mh /* number */, fromWoKey, toWoKey, origin /* 'plan' | 'user' */ }
```

- ร่างเก็บในตัวแปร `rebalanceDraft` (array) ของส่วน UI **ไม่บันทึกลง localStorage** รีโหลดหน้าแล้วกด Run ระบบจะสร้างร่างใหม่
- `id` เป็นตัวเลขที่นับเพิ่มไปเรื่อย ๆ ใช้ผูกแถวในหน้าเว็บกับ error / warning

### การสร้างร่าง

- `movesToDraft(moves)` รวม move ของ `planRebalance` ที่มี `nameKey + sq + day + fromWoKey + toWoKey` เดียวกันเป็นแถวเดียว (MH รวมกัน) และใส่ `origin: 'plan'` ลำดับแถวเป็นไปตาม move แรกของแต่ละกลุ่ม
- จะสร้างร่างใหม่ (ร่างเดิมหายทั้งหมด) เฉพาะเมื่อ:
  - กด **Run**
  - กด **↻ คำนวณคำแนะนำใหม่**
  - กด **ทำต่อ (รอบที่ 2)** (วางแผนใหม่ด้วย `includeRound2: true`)
  - กด **Apply** แล้วยังมี squad เกิน 80% (คำนวณจาก Timesheet หลัง Apply)
  - **อัปโหลด .xlsx** หรือกด **Undo** (ร่างถูกล้างเป็นว่าง แล้วค่อยสร้างใหม่ตอน Run)
- ถ้าแก้ Timesheet ระหว่างที่มีร่างอยู่ **ร่างยังอยู่** เพื่อไม่ให้ที่ user แก้ในร่างหายไปเฉย ๆ
  - หลัง Apply แล้ว: การคำนวณอัตโนมัติ (ส่วนที่ 2) จะเช็กร่างกับ Timesheet ค่าล่าสุดให้เอง
  - ก่อน Apply ครั้งแรก: ไม่มีการคำนวณอัตโนมัติเหมือนเดิม ร่างจะถูกเช็กใหม่ตอนแก้ร่างครั้งถัดไป หรือตอนกด Apply (Apply เรียก `resolveDraft` กับ Timesheet ปัจจุบันเสมอ) ส่วนการกด Run จะสร้างร่างใหม่
- state เดิม `rebalanceOverrides` กับ `targetOverrides` ของ dropdown ถูกเลิกใช้ เพราะการเลือก WO ปลายทางย้ายมาอยู่ในร่างแล้ว ส่วน `planRebalance` ยังรับ option นี้ได้เหมือนเดิม

### การแก้ร่าง

| ช่อง | ตัวเลือก |
|---|---|
| วัน | 1–31 |
| MH | ตัวเลข > 0 ทศนิยมได้ |
| จาก WO | WO ทุกตัวที่คนนั้นมีแถวอยู่ใน squad นั้น |
| ไป CAPEX WO | CAPEX WO ทุกตัวใน Mapping (เรียงแบบ `optionsFor`: WO ที่คนนั้นมีแถวอยู่แล้วขึ้นก่อน) |

- **🗑** ลบแถวนั้น
- **+ เพิ่มการย้าย** เพิ่มแถว `origin: 'user'` เลือกคนได้จาก (ชื่อ, squad) ทุกคู่ใน Timesheet ค่าเริ่มต้น:
  - คน: คนแรกในรายการ
  - จาก WO: OPEX WO ที่คนนั้นลงมากที่สุด ถ้าไม่มี OPEX ใช้ WO แรกของคนนั้น
  - ไป: CAPEX WO แรกของคนนั้น ถ้าไม่มี ใช้ CAPEX WO แรกใน Mapping
  - วัน: วันล่าสุดที่ "จาก WO" มีค่า > 0 ถ้าไม่มีเลยใช้วันที่ 1
  - MH: 1
- ถ้าเปลี่ยนคนในแถว ช่อง จาก / ไป / วัน จะถูกตั้งใหม่ตามค่าเริ่มต้นข้างบน
- ทุกครั้งที่แก้ ระบบ validate ใหม่และคำนวณ "ถ้า Apply ตามนี้" ใหม่ทันที

### การ validate: `resolveDraft(rows, draft, ctx)`

`ctx` = `{ mapping, roleMap, ceilings, workingDays, remainingLast }` ซึ่งเป็นชุดเดียวกับ `buildRebalanceCtx` ฟังก์ชันคืนค่า:

```js
{ moves, errors: { [id]: 'ข้อความ' }, warnings: { [id]: ['ข้อความ', ...] }, previewRows }
```

ไล่ร่างตามลำดับแถว ทีละแถว:

**Error (แถวนั้นไม่ถูกนำไปใช้ และปุ่ม Apply ถูกปิด)**
1. `mh` ไม่ใช่ตัวเลข > 0 → `MH ต้องมากกว่า 0`
2. `day` ไม่ใช่จำนวนเต็ม 1–31 → `วันต้องเป็น 1–31`
3. `fromWoKey === toWoKey` → `จาก WO กับไป WO ต้องไม่ใช่ตัวเดียวกัน`
4. `toWoKey` ไม่ใช่ CAPEX ใน Mapping → `ไป WO ต้องเป็น CAPEX`
5. ไม่เจอแถวของคนนั้น (nameKey + sq) ที่มี WO = `fromWoKey` → `ไม่พบแถว <WO> ของ <ชื่อ>`
6. `mh` มากกว่าที่เหลือในช่องต้นทาง → `วันที่ <d> ของ <WO> เหลือให้ย้ายได้ <x> MH` (ช่องต้นทาง = แถวของคนนั้นที่มี WO นี้และมีชั่วโมงในวันนั้นมากที่สุด ที่เหลือ = ค่าในช่องนั้น ลบ MH ที่แถวร่างก่อนหน้าดึงจากช่องเดียวกันไปแล้ว)

**แถวที่ผ่าน** จะกลายเป็น move 1 ตัว ใช้ field ชุดเดียวกับ move ของ `planRebalance` คือ `nameKey, name, sq, fte, round: 0, fromRow, fromWoNo, fromWoKey, toRow, toWoNo, toWoKey, toWoName, day, mh`
- `toRow` = แถวของคนนั้นที่มี WO = `toWoKey` ถ้าไม่มีให้เป็น `null` แล้ว `applyMoves` จะสร้างแถวใหม่ให้
- `round: 0` หมายถึงมาจากร่าง

**Warning (ยัง Apply ได้)** คำนวณจาก `previewRows = applyMoves(rows, moves)`
- CAPEX ของคนนั้นใน `previewRows` เกินเพดาน CAPEX ของตำแหน่ง (`ceiling.capex × workingDays ÷ 20 × 8` MH) → `CAPEX ของ <ชื่อ> จะเป็น <x> MD เกินเพดาน <y> MD` เตือนทุกแถวของคนนั้น ถ้าคนนั้นไม่มีตำแหน่ง หรือตำแหน่งไม่มีในตารางเพดาน ข้ามการเช็กนี้
- WO ปลายทางมี Remaining (เดือนที่แล้ว) และ Remaining − Man-Day ของ WO นั้นใน `previewRows` < 0 → `Remaining ของ <WO> จะติดลบ <x> MD`

**ถ้า Apply ตามนี้**: ใช้ `summarizeRows(previewRows, mapping).table2` เทียบกับ table2 ปัจจุบัน แสดงเฉพาะ squad ที่ % เปลี่ยน รูปแบบเดียวกับตารางสรุป (`pctDiff`) และ OPEX ที่ยัง > 80% ขึ้นสีแดง

**ปุ่ม Apply** ปิดเมื่อร่างว่าง หรือมี error อย่างน้อย 1 แถว

### การกด Apply

- `setTimesheetRows(applyMoves(rows, moves))` เหมือนเดิม
- `rebalanceState.moves` ต่อท้ายด้วย `moves` ที่ผ่าน `resolveDraft` แล้ว ทำให้รู้ว่า "Rebalance เปลี่ยนอะไรไปบ้าง" ไม่ว่ามาจาก plan หรือจาก user ในร่าง
- จากนั้น refresh แบบวางแผนใหม่ (ดูส่วนที่ 2)

## ส่วนที่ 2: หลัง Apply

### คำนวณใหม่อัตโนมัติ

- แยกงานของปุ่ม Run ออกมาเป็น `refresh({ replan })`
  - ปุ่ม Run เรียก `refresh({ replan: true })` ทำงานเหมือนเดิม และสร้างร่างใหม่
  - การคำนวณอัตโนมัติเรียก `refresh({ replan: false })` คำนวณ Table 1/2, สรุป CAPEX/OPEX, ประวัติ, สีของช่อง และ validate ร่างเดิมใหม่ ถ้ายังไม่มีร่าง (`rebalanceDraft === null`) และมี squad เกิน 80% ให้สร้างร่างให้
- การคำนวณอัตโนมัติ**ทำเฉพาะเมื่อ `rebalanceState` มีค่า** (คือหลัง Apply) โดยผูกกับ `onChange` ของ timesheet grid และรอ 300 ms หลังการแก้ครั้งสุดท้าย (debounce)
- ระหว่าง refresh อัตโนมัติ ห้ามสร้าง input ของ timesheet grid ใหม่ เพราะ cursor จะหลุดตอนกำลังพิมพ์ ให้แก้เฉพาะ class / title ของช่อง

### ระบายสีช่องที่เปลี่ยน

- ช่อง Day ใน timesheet grid ที่ค่าต่างจากฉบับเดิมได้ class `cell-changed` (สีเหลือง เหมือน Table 1) และ `title="เดิม: <x>"` ถ้าเดิมว่างให้เขียน `เดิม: ว่าง`
- เทียบด้วย key `nameKey | sq | woKey` + วัน ไม่ได้เทียบด้วยลำดับแถว เพราะ user อาจเพิ่ม ลบ หรือสลับแถว ถ้าในฉบับใดฉบับหนึ่งมีหลายแถวที่ key ซ้ำกัน ให้รวมค่าของแถวเหล่านั้นก่อนเทียบ และระบายทุกช่องของ key / วันนั้น
- เทียบตัวเลขด้วย `parseNum` แล้วปัดที่ 1e-6 ถ้าเป็นค่าว่างหรือ 0 ถือว่า "ว่าง"
- ไม่มี `rebalanceState` = ไม่ระบายสี

### ประวัติการแก้ไข: `diffTimesheets(original, current, appliedMoves)`

- `expected` = ฉบับเดิมที่รวมผลของ `appliedMoves` แล้ว คำนวณด้วย key (ช่องต้นทาง −mh, ช่องปลายทาง +mh) ไม่ใช้เลขแถว จึงยังถูกแม้ user จะเพิ่มหรือลบแถว
- ไล่ทุก key + วัน ที่ค่าในฉบับเดิมต่างจากฉบับปัจจุบัน:
  - ค่าปัจจุบัน = `expected` → **แก้โดย "Rebalance"**
  - ไม่เท่า → **แก้โดย "แก้เอง"** เช่น Rebalance เปลี่ยน 8 → 6 แล้ว user แก้ต่อเป็น 5 จะได้แถวเดียว คือ เดิม 8, ใหม่ 5, แก้เอง
- คืน `{ header: ['Name-Surname', 'Squad', 'WO No.', 'Day', 'เดิม', 'ใหม่', 'แก้โดย'], rows }` เรียงตามลำดับที่ key โผล่ใน current (ต่อด้วย key ที่มีแค่ใน original) แล้วเรียงตามวัน
- ค่า "ว่าง" แสดงเป็นช่องว่าง ส่วน "WO No." ใช้ WO No. ตามที่เขียนในแถว
- แทนที่ `buildChangeLog` (ฟังก์ชันเดิมลบได้ แต่ต้องย้าย test ไปด้วย) Copy / Download CSV ของการ์ดประวัติใช้ผลชุดใหม่
- การ์ดประวัติโชว์เมื่อ `rebalanceState` มีค่าและ diff มีอย่างน้อย 1 แถว

### รีโหลดหน้า

- `rebalanceState` (ฉบับเดิม + moves) กับ Timesheet ปัจจุบันถูกบันทึกอยู่แล้ว ประวัติและสีของช่องจึงกลับมาถูกต้องหลังกด Run
- การแก้ Timesheet หลัง Apply ถูกบันทึกผ่าน `persistTimesheetText()` อยู่แล้วใน `onChange` ของ grid

### Undo

เหมือนเดิม คือคืนเป็นฉบับเดิมทั้งหมด ล้างร่าง ล้างสี และซ่อนประวัติ

## ส่วนที่ 3: โครงสร้างโค้ด

**ส่วน logic (`<script id="app-logic">`, export ผ่าน `module.exports`)** เป็นฟังก์ชันล้วนที่ไม่แตะ DOM
- `movesToDraft(moves)`
- `resolveDraft(rows, draft, ctx)`
- `diffTimesheets(original, current, appliedMoves)`
- helper ภายใน: `cellKey(row)` → `nameKey|sq|woKey`, `cellTotals(rows)` → `{ key: { day: mh } }` ใช้ร่วมกันใน `resolveDraft` (ที่เหลือในช่องต้นทาง) และ `diffTimesheets`

**ส่วน UI**
- state: `rebalanceDraft` (array หรือ `null`), `nextDraftId`
- `renderRebalance()` วาดตารางร่าง, error / warning, "ถ้า Apply ตามนี้", ปุ่ม Apply / ทำต่อ / คำนวณใหม่ แล้วต่อด้วยส่วนหลัง Apply เดิม (Copy Timesheet, Undo, ดาวน์โหลด, สรุป CAPEX/OPEX)
- event ของร่างใช้ event delegation บน `rebalanceContainer` ซึ่งมีอยู่แล้ว ด้วย `data-draft-id` + `data-field`
  - ช่องตัวเลข MH อัปเดตร่างตอน `input` แต่ไม่วาดตารางร่างใหม่ทั้งตาราง (cursor จะหลุด) วาดใหม่เฉพาะ error / warning / preview
  - select อัปเดตแล้ววาดใหม่ได้
- `refresh({ replan })` แทนตัว handler ของปุ่ม Run, `scheduleAutoRefresh()` ทำ debounce, `markChangedCells()` ระบายสีช่อง

## ส่วนที่ 4: การ test

**Node (`tests/rebalance.js`)**
- `movesToDraft`: รวม move ที่วันและ WO เดียวกัน, ลำดับแถว, origin
- `resolveDraft`: ร่างว่าง, error ทั้ง 6 แบบ, ช่องต้นทางเดียวกันถูกดึงจากหลายแถวรวมกันเกินที่มี, `toRow: null` เมื่อคนนั้นไม่มีแถว WO ปลายทาง, warning เพดาน CAPEX และ Remaining ติดลบ, previewRows ถูกต้อง
- `diffTimesheets`: ไม่มีการเปลี่ยน → ว่าง, ช่องของ Rebalance, ช่องที่แก้เอง, แก้ทับช่องของ Rebalance → แก้เอง, แก้กลับเป็นค่าเดิม → หายจากประวัติ, แถวที่ Rebalance สร้างใหม่ (เดิม ว่าง), user ลบหรือสลับแถวแล้วยังเทียบถูก

**Browser (`tests/browser_e2e.py`)**
- แก้ MH / วัน / จาก / ไป ในร่างแล้ว "ถ้า Apply ตามนี้" ต้องเปลี่ยน
- ลบแถวร่าง, เพิ่มแถวร่าง (ค่าเริ่มต้นถูก), เปลี่ยนคนแล้วค่าเริ่มต้นตั้งใหม่
- MH เกินที่ลงไว้ → แถวแดงและปุ่ม Apply ปิด, warning เพดานไม่ปิด Apply
- Apply ร่างที่แก้แล้ว → Timesheet ตรงกับร่าง และประวัติเป็น "Rebalance"
- หลัง Apply แก้ช่องเอง → Table 2 / สรุป / ประวัติ ("แก้เอง") อัปเดตโดยไม่ต้องกด Run, ช่องขึ้นสีและมี title "เดิม: …", แก้กลับเป็นค่าเดิมแล้วสีกับประวัติหาย
- พิมพ์ในช่อง Timesheet หลัง Apply แล้ว cursor ไม่หลุด (focus ยังอยู่ที่ช่องเดิม)
- รีโหลดหน้า + Run → ประวัติยังแยก Rebalance / แก้เองถูก
- Undo คืนทุกอย่าง ทั้งที่ Rebalance และที่แก้เอง
- แก้ test เดิมที่อ้าง `select.rb-target` และประวัติแบบ จาก → ไป ให้ตรงกับหน้าตาใหม่

## นอกขอบเขต

- บันทึกร่างลง localStorage
- เปลี่ยนอัลกอริทึมของ `planRebalance`
- ย้ายจาก CAPEX ไป OPEX หรือไป Non Charge (ไป WO ต้องเป็น CAPEX เสมอ)
- ประวัติแบบบันทึกทุกขั้นตามเวลา
