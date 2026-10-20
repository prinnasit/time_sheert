# tests/browser_e2e.py — drives index.html in a real (headless) Chromium:
# paste into the grids, Run, Rebalance (Apply / Continue / Undo / target WO),
# Remaining + new month, downloads, .xlsx upload and localStorage persistence.
# The Node tests only exercise the app-logic block; this one catches wiring
# bugs between the DOM and that logic.
#
# Setup (once):  pip install playwright && python -m playwright install chromium
# Run:           python tests/browser_e2e.py
# Needs internet: index.html loads SheetJS (xlsx) from the jsDelivr CDN.
import re
import sys
import tempfile
from pathlib import Path

from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parent.parent
APP_URL = (ROOT / 'index.html').as_uri()
SAMPLE_XLSX = ROOT / 'krungsri.xlsx'
DOWNLOAD_DIR = Path(tempfile.mkdtemp(prefix='wo-e2e-'))

failures = 0


def test(name, fn, browser):
    global failures
    # A fresh context per test = empty localStorage, so no test sees the
    # mapping / roles / rebalance state saved by the one before it.
    context = browser.new_context(accept_downloads=True)
    page = context.new_page()
    page_errors = []
    page.on('pageerror', lambda err: page_errors.append(str(err)))
    try:
        page.goto(APP_URL)
        page.wait_for_load_state('networkidle')
        fn(page)
        assert not page_errors, 'uncaught JS error(s): ' + '; '.join(page_errors)
        print('  ok - ' + name)
    except Exception as err:
        failures += 1
        print('  FAIL - ' + name)
        print('    ' + str(err).splitlines()[0])
    finally:
        context.close()


# ---- helpers ---------------------------------------------------------------

def paste_into_grid(page, grid_id, text, row_index=0):
    # Same path as a user pasting a block from Excel into a row's first cell:
    # the grid's own paste handler spreads it across rows and columns.
    first_cell = page.locator('#' + grid_id + ' tbody tr').nth(row_index).locator('input, select').first
    first_cell.evaluate('''(el, text) => {
        const dt = new DataTransfer();
        dt.setData('text/plain', text);
        el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }''', text)


def tsv(rows):
    return '\n'.join('\t'.join(r) for r in rows)


def timesheet_row(name, sq, wo, day_values):
    days = [''] * 31
    for day, v in day_values.items():
        days[day - 1] = str(v)
    return [name, sq, wo, wo, 'FTE'] + days


def day_col(day):
    return 5 + day - 1  # Name, SQ, WO No., WO Name, FTE/OS come first


def grid_rows(page, grid_id):
    return page.locator('#' + grid_id + ' tbody tr')


def grid_cell(page, grid_id, row_index, col_index):
    return grid_rows(page, grid_id).nth(row_index).locator('input, select').nth(col_index)


def grid_row_where(page, grid_id, col_index, value):
    # The grids set el.value (the property), not the value="" attribute, so
    # a CSS selector like input[value="C2"] never matches — look it up live.
    index = page.evaluate('''([gridId, col, value]) =>
        [...document.querySelectorAll('#' + gridId + ' tbody tr')]
            .findIndex(tr => (tr.querySelectorAll('input, select')[col] || {}).value === value)''',
        [grid_id, col_index, value])
    assert index >= 0, 'no row in #' + grid_id + ' with "' + value + '" in column ' + str(col_index)
    return grid_rows(page, grid_id).nth(index)


def table2_row(page, squad):
    return page.locator('#table2-container tbody tr', has=page.locator('td', has_text=re.compile('^' + squad + '$')))


def opex_cell(page, squad):
    # Table 2 columns: Squad | CAPEX % | OPEX % [| OPEX % (เดิม)]
    return table2_row(page, squad).locator('td').nth(2)


def table1_cell(page, squad, wo_no):
    # Header row 2 lists the WO No. of every column; the first <th> there is
    # "Squad" (rowspan=2), so a WO's index in that row is also its <td> index.
    headers = page.locator('#table1-container thead tr').nth(1).locator('th').all_inner_texts()
    col = headers.index(wo_no)
    row = page.locator('#table1-container tbody tr', has=page.locator('td', has_text=re.compile('^' + squad + '$')))
    return row.locator('td').nth(col)


def download(page, click_selector):
    with page.expect_download() as info:
        page.click(click_selector)
    d = info.value
    path = DOWNLOAD_DIR / d.suggested_filename
    d.save_as(path)
    return d.suggested_filename, path


def paste_mapping(page, mapping):
    # The grid starts with DEFAULT_WO_MAPPING; clear it so only the
    # scenario's own WOs are in play.
    page.click('#clear-mapping-btn')
    paste_into_grid(page, 'mapping-grid', tsv(mapping))


def setup(page, mapping, timesheet, people=None, working_days='20'):
    paste_mapping(page, mapping)
    paste_into_grid(page, 'timesheet-grid', tsv(timesheet))
    if people:
        paste_into_grid(page, 'people-roles-grid', tsv(people) + '\n')
    page.fill('#working-days-input', working_days)  # ceilings are scaled by working days / 20
    page.click('#run-btn')


# ---- scenarios -------------------------------------------------------------

MAPPING = [['C1', 'CAPEX', 'Cap 1'], ['C2', 'CAPEX', 'Cap 2'], ['O1', 'OPEX', 'Ops 1'], ['Z01', 'Non Charge', 'Leave']]
DEV1 = [['Dev1', 'Developer']]

# Dev1 in S1: CAPEX 16 MH, OPEX 72 MH -> 72/88 = 81.82% (over 80%).
# Round 1 moves 2 MH on day 11 from O1 to C1 -> 70/88 = 79.55%.
OVER_80 = [
    timesheet_row('Dev1', 'S1', 'C1', {1: 8, 2: 8}),
    timesheet_row('Dev1', 'S1', 'O1', {d: 8 for d in range(3, 12)}),
]

# Dev4: CAPEX 1, OPEX 18 -> 94.74%. Round 1 may only take OPEX down to the
# Developer ceiling (2 MD = 16 MH), i.e. 2 MH -> 84.21%, still over; round 2
# ("ทำต่อ") uses CAPEX headroom for 1 more MH -> 15/19 = 78.95%.
NEEDS_ROUND_2 = [
    timesheet_row('Dev4', 'S1', 'C1', {1: 1}),
    timesheet_row('Dev4', 'S1', 'O1', {2: 8, 3: 8, 4: 2}),
]


def setup_over_80(page):
    setup(page, MAPPING, OVER_80, DEV1)


# ---- Run + banners ---------------------------------------------------------

def run_without_mapping_shows_error(page):
    page.click('#clear-mapping-btn')
    page.click('#run-btn')
    expect(page.locator('#banners')).to_contain_text('กรุณาวางตาราง WO Mapping ก่อนกด Run')


def run_without_timesheet_shows_error(page):
    page.click('#run-btn')  # the default mapping is enough to get past the mapping check
    expect(page.locator('#banners')).to_contain_text('กรุณาวางข้อมูล Timesheet ก่อนกด Run')


def run_warns_about_unmapped_and_duplicate_wos(page):
    setup(page, MAPPING + [['C1', 'CAPEX', 'Cap 1 again']], [
        timesheet_row('Ann', 'S2', 'C1', {1: 8}),
        timesheet_row('Ann', 'S2', 'W999', {2: 8}),
    ])
    banners = page.locator('#banners')
    expect(banners).to_contain_text('พบ WO No. ซ้ำกันในตาราง Mapping (ใช้แถวล่างสุดที่พบ): C1')
    expect(banners).to_contain_text('พบ WO No. ที่ไม่มีในตาราง Mapping: W999')
    # A warning doesn't stop the run — the tables are still built.
    expect(page.locator('#table1-container')).to_contain_text('S2')


def run_builds_tables_and_flags_high_opex(page):
    setup_over_80(page)
    expect(table1_cell(page, 'S1', 'C1')).to_have_text('2.00')  # 16 MH = 2 Man-Day
    expect(table1_cell(page, 'S1', 'O1')).to_have_text('9.00')
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')
    expect(opex_cell(page, 'S1')).to_have_class(re.compile('pct-alert'))
    expect(page.locator('#rebalance-card')).to_be_visible()
    expect(page.locator('#rebalance-container')).to_contain_text('Dev1')


def exactly_80_percent_needs_no_rebalance(page):
    setup(page, MAPPING, [
        timesheet_row('Dev1', 'S1', 'C1', {1: 8, 2: 8}),
        timesheet_row('Dev1', 'S1', 'O1', {d: 8 for d in range(3, 11)}),  # 64 / 80 = 80.00%
    ], DEV1)
    expect(opex_cell(page, 'S1')).to_have_text('80.00%')
    expect(opex_cell(page, 'S1')).not_to_have_class(re.compile('pct-alert'))
    expect(page.locator('#rebalance-card')).to_be_hidden()


# ---- Rebalance -------------------------------------------------------------

def apply_then_undo_round_trips_the_timesheet(page):
    setup_over_80(page)
    opex_day11 = grid_cell(page, 'timesheet-grid', 1, day_col(11))
    capex_day11 = grid_cell(page, 'timesheet-grid', 0, day_col(11))
    expect(opex_day11).to_have_value('8')

    page.click('[data-rb-action="apply"]')
    expect(opex_day11).to_have_value('6')
    expect(capex_day11).to_have_value('2')
    expect(opex_cell(page, 'S1')).to_have_text('79.55%')
    expect(opex_cell(page, 'S1')).not_to_have_class(re.compile('pct-alert'))
    expect(table2_row(page, 'S1').locator('td').nth(3)).to_have_text('81.82%')  # OPEX % (เดิม)
    # Table 1 shows "before → after" on the cells that changed.
    expect(table1_cell(page, 'S1', 'C1')).to_have_text('2.00 → 2.25')
    expect(table1_cell(page, 'S1', 'C1')).to_have_class(re.compile('cell-changed'))
    expect(table1_cell(page, 'S1', 'O1')).to_have_text('9.00 → 8.75')
    log_row = page.locator('#changelog-container tbody tr')
    expect(log_row).to_have_count(1)
    expect(log_row.first.locator('td')).to_have_text(['Dev1', 'S1', 'O1', 'C1', '11', '2'])

    page.click('[data-rb-action="undo"]')
    expect(opex_day11).to_have_value('8')
    expect(capex_day11).to_have_value('')
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')
    expect(table1_cell(page, 'S1', 'C1')).to_have_text('2.00')
    expect(page.locator('#changelog-card')).to_be_hidden()


def continue_runs_round_2_when_round_1_is_not_enough(page):
    setup(page, MAPPING, NEEDS_ROUND_2, [['Dev4', 'Developer']])
    rebalance = page.locator('#rebalance-container')
    expect(rebalance).to_contain_text('รอบที่ 1')
    expect(page.locator('[data-rb-action="continue"]')).to_be_visible()

    page.click('[data-rb-action="continue"]')
    expect(page.locator('[data-rb-action="continue"]')).to_have_count(0)
    expect(rebalance).to_contain_text('✓ S1: OPEX 94.74% → 78.95%')

    page.click('[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('78.95%')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(4))).to_have_value('')   # 2 MH moved out
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(3))).to_have_value('7')  # round 2's 1 MH
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(4))).to_have_value('2')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(3))).to_have_value('1')


def apply_without_continue_only_does_round_1(page):
    setup(page, MAPPING, NEEDS_ROUND_2, [['Dev4', 'Developer']])
    page.click('[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('84.21%')
    expect(opex_cell(page, 'S1')).to_have_class(re.compile('pct-alert'))
    # Still over 80%, so the card offers round 2 again plus Undo.
    expect(page.locator('[data-rb-action="continue"]')).to_be_visible()
    expect(page.locator('[data-rb-action="undo"]')).to_be_visible()


def target_wo_dropdown_redirects_the_move(page):
    setup_over_80(page)
    select = page.locator('#rebalance-container select.rb-target')
    expect(select).to_have_value('C1')  # Dev1's own CAPEX WO comes first
    select.select_option('C2')          # a CAPEX WO Dev1 has no row for yet
    expect(page.locator('#rebalance-container select.rb-target')).to_have_value('C2')

    page.click('[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(11))).to_have_value('')  # C1 untouched
    expect(page.locator('#changelog-card')).to_be_visible()  # Apply has finished re-rendering
    new_row = grid_row_where(page, 'timesheet-grid', 2, 'C2')
    expect(new_row.locator('input').nth(0)).to_have_value('Dev1')
    expect(new_row.locator('input').nth(day_col(11))).to_have_value('2')
    expect(page.locator('#changelog-container tbody tr td').nth(3)).to_have_text('C2')


def people_without_a_role_are_skipped_with_a_reason(page):
    setup(page, MAPPING, OVER_80)  # no People -> Role rows at all
    expect(page.locator('#rebalance-container')).to_contain_text('ข้ามคนที่ระบบแก้ให้ไม่ได้: Dev1 (ยังไม่ได้ระบุตำแหน่ง)')
    expect(page.locator('[data-rb-action="apply"]')).to_be_disabled()


def unknown_role_is_skipped_with_a_reason(page):
    setup(page, MAPPING, OVER_80, [['Dev1', 'Wizard']])
    expect(page.locator('#rebalance-container')).to_contain_text('ไม่พบตำแหน่ง "Wizard" ในตารางเพดาน')


def apply_survives_a_reload(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('6')
    page.reload()
    page.wait_for_load_state('networkidle')
    # The edited timesheet and the saved original both come back from
    # localStorage, so Undo must still be reachable after a reload.
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('6')
    page.click('#run-btn')
    page.click('[data-rb-action="undo"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('8')


def copy_new_timesheet_puts_rows_on_the_clipboard(page):
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    btn = page.locator('[data-rb-action="copy-new"]')
    btn.click()
    expect(btn).to_have_text('✓ Copied 2 แถว')
    lines = page.evaluate('navigator.clipboard.readText()').split('\n')
    assert len(lines) == 2, lines                            # data rows only, no header
    cells = [line.split('\t') for line in lines]
    assert cells[0][:3] == ['Dev1', 'S1', 'C1'], cells[0][:5]
    assert cells[0][day_col(11)] == '2' and cells[1][day_col(11)] == '6', (cells[0][day_col(11)], cells[1][day_col(11)])
    assert all(len(c) == 36 for c in cells), [len(c) for c in cells]


def copy_new_timesheet_warns_about_added_rows(page):
    setup_over_80(page)
    page.locator('#rebalance-container select.rb-target').select_option('C2')  # Dev1 has no C2 row
    page.click('[data-rb-action="apply"]')
    expect(page.locator('#rebalance-container')).to_contain_text('มีแถวใหม่ 1 แถวต่อท้าย')


def downloaded_new_timesheet_uploads_back_with_the_edits(page):
    setup_over_80(page)
    page.click('[data-rb-action="apply"]')
    name, path = download(page, '[data-rb-action="dl-new"]')
    assert re.fullmatch(r'timesheet-new_\d{4}-\d{2}-\d{2}\.xlsx', name), name
    orig_name, _ = download(page, '[data-rb-action="dl-original"]')
    assert orig_name.startswith('timesheet-original_'), orig_name

    # Round trip: the file we wrote must be readable by our own uploader.
    page.set_input_files('#xlsx-upload', str(path))
    expect(page.locator('#upload-status')).to_have_text('Loaded 2 row(s) from ' + name)
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('6')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(11))).to_have_value('2')
    # Uploading a new timesheet resets the rebalance session.
    expect(page.locator('#rebalance-card')).to_be_hidden()
    expect(page.locator('#changelog-card')).to_be_hidden()


# ---- Remaining + new month -------------------------------------------------

def remaining_this_month_is_last_month_minus_actual(page):
    setup_over_80(page)
    page.locator('#table1-container .remaining-input[data-wo-key="C1"]').fill('10')
    expect(page.locator('#table1-container .remaining-computed[data-wo-key="C1"]')).to_have_text('8.00')  # 10 - 2.00
    # The same value shows up in the Mapping grid's Remaining column (row 1 = C1).
    expect(grid_cell(page, 'mapping-grid', 0, 3)).to_have_value('10')


def new_month_rolls_this_month_into_last_month(page):
    setup_over_80(page)
    page.locator('#table1-container .remaining-input[data-wo-key="C1"]').fill('10')
    page.click('#new-month-btn')
    expect(page.locator('#new-month-status')).to_contain_text('อัปเดตแล้ว')
    expect(page.locator('#table1-container .remaining-input[data-wo-key="C1"]')).to_have_value('8')
    expect(page.locator('#table1-container .remaining-computed[data-wo-key="C1"]')).to_have_text('6.00')


def new_month_before_run_shows_error(page):
    page.click('#new-month-btn')
    expect(page.locator('#banners')).to_contain_text('กรุณากด Run ก่อนขึ้นเดือนใหม่')


# ---- Export ----------------------------------------------------------------

def download_csv_before_run_shows_error(page):
    page.click('#download-table1-btn')
    expect(page.locator('#banners')).to_contain_text('กรุณากด Run ก่อน Download')


def download_table_csvs(page):
    setup_over_80(page)
    name1, path1 = download(page, '#download-table1-btn')
    assert re.fullmatch(r'wo-summary_\d{4}-\d{2}-\d{2}\.csv', name1), name1
    csv1 = path1.read_text(encoding='utf-8')
    assert csv1.startswith('﻿'), 'Table 1 CSV is missing the UTF-8 BOM Excel needs for Thai text'
    assert 'S1' in csv1 and 'Remaining (เดือนนี้)' in csv1, csv1[:200]

    name2, path2 = download(page, '#download-table2-btn')
    assert name2.startswith('wo-percent_'), name2
    lines = path2.read_text(encoding='utf-8-sig').splitlines()
    assert lines[0] == 'Squad,CAPEX %,OPEX %', lines[0]
    assert lines[1].startswith('S1,'), lines[1]


def copy_table_flashes_copied(page):
    setup_over_80(page)
    page.click('#copy-table1-btn')
    expect(page.locator('#copy-table1-btn')).to_have_text('✓ Copied')


# ---- Upload ----------------------------------------------------------------

def upload_sample_xlsx_fills_the_grid(page):
    page.set_input_files('#xlsx-upload', str(SAMPLE_XLSX))
    expect(page.locator('#upload-status')).to_have_text(re.compile(r'^Loaded [1-9]\d* row\(s\) from krungsri\.xlsx$'))
    expect(grid_cell(page, 'timesheet-grid', 0, 0)).not_to_have_value('')


def upload_non_xlsx_shows_error(page):
    page.set_input_files('#xlsx-upload', {'name': 'notes.xlsx', 'mimeType': 'text/plain', 'buffer': b'just some text'})
    expect(page.locator('#upload-status')).to_contain_text('ไฟล์นี้ดูไม่ใช่ไฟล์ Excel')


# ---- Persistence + small controls ------------------------------------------

def first_visit_loads_the_default_wo_mapping(page):
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')
    expect(grid_cell(page, 'mapping-grid', 0, 1)).to_have_value('CAPEX')
    expect(grid_cell(page, 'mapping-grid', 0, 2)).to_have_value('ONE Corporate MVP1')
    expect(grid_cell(page, 'mapping-grid', 6, 1)).to_have_value('OPEX')         # WO-07
    expect(grid_cell(page, 'mapping-grid', 13, 0)).to_have_value('Z02')
    expect(grid_cell(page, 'mapping-grid', 13, 1)).to_have_value('Non Charge')
    # The defaults are usable straight away: Run classifies them without warnings.
    paste_into_grid(page, 'timesheet-grid', tsv([
        timesheet_row('Ann', 'S1', 'WO-01', {1: 8}),
        timesheet_row('Ann', 'S1', 'Z01', {2: 8}),
    ]))
    page.click('#run-btn')
    expect(table1_cell(page, 'S1', 'WO-01')).to_have_text('1.00')
    expect(page.locator('#banners')).to_be_empty()


def first_visit_loads_the_default_people_roles(page):
    expect(grid_cell(page, 'people-roles-grid', 0, 0)).to_have_value('Person 01')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Head of Innovation')
    expect(grid_cell(page, 'people-roles-grid', 9, 0)).to_have_value('Person 10')
    expect(grid_cell(page, 'people-roles-grid', 9, 1)).to_have_value('Developer')
    expect(grid_cell(page, 'people-roles-grid', 36, 0)).to_have_value('Person 37')


def people_roles_reset_restores_the_defaults(page):
    grid_cell(page, 'people-roles-grid', 0, 1).fill('Developer')
    page.click('#people-roles-reset-btn')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Head of Innovation')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Head of Innovation')


def an_edited_mapping_replaces_the_defaults_after_a_reload(page):
    grid_cell(page, 'mapping-grid', 0, 2).fill('Renamed WO')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 0, 2)).to_have_value('Renamed WO')


def mapping_roles_and_working_days_survive_a_reload(page):
    paste_mapping(page, MAPPING)
    paste_into_grid(page, 'people-roles-grid', tsv(DEV1) + '\n')
    page.fill('#working-days-input', '18')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 1, 0)).to_have_value('C2')
    expect(grid_cell(page, 'mapping-grid', 1, 1)).to_have_value('CAPEX')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Developer')
    expect(page.locator('#working-days-input')).to_have_value('18')


def clear_mapping_empties_the_grid(page):
    page.click('#clear-mapping-btn')
    expect(page.locator('#mapping-status')).to_have_text('Cleared')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('')
    # An empty mapping is never useful, so a reload starts from the defaults.
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')


def saved_but_empty_tables_fall_back_to_the_defaults(page):
    # What an older visit can leave behind: a mapping with only its header
    # row, and Role Ceilings with every row deleted.
    page.evaluate('''() => {
        localStorage.setItem('woTimesheetSummary.mappingText', 'WO No.\\tCategory\\tWO Name\\tRemaining (เดือนที่แล้ว)\\n\\t\\t\\t');
        localStorage.setItem('woTimesheetSummary.roleCeilings', '[]');
    }''')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')
    expect(grid_cell(page, 'role-ceilings-grid', 0, 0)).to_have_value('Automated Tester')


def mapping_reset_restores_the_defaults(page):
    paste_mapping(page, MAPPING)
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('C1')
    page.click('#mapping-reset-btn')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')
    expect(grid_cell(page, 'mapping-grid', 4, 0)).to_have_value('WO-05')  # pasted rows are gone, not merged
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')


def role_ceilings_reset_restores_defaults(page):
    grid_row_where(page, 'role-ceilings-grid', 0, 'Developer').locator('input').nth(3).fill('99')
    page.reload()
    page.wait_for_load_state('networkidle')
    # The edit is remembered across reloads...
    expect(grid_row_where(page, 'role-ceilings-grid', 0, 'Developer').locator('input').nth(3)).to_have_value('99')
    # ...until คืนค่าเริ่มต้น puts the default (Developer OPEX = 2 MD) back.
    page.click('#role-ceilings-reset-btn')
    expect(grid_row_where(page, 'role-ceilings-grid', 0, 'Developer').locator('input').nth(3)).to_have_value('2')


TESTS = [
    ('Run with an empty mapping shows an error banner', run_without_mapping_shows_error),
    ('Run with an empty timesheet shows an error banner', run_without_timesheet_shows_error),
    ('Run warns about unmapped and duplicate WOs but still builds the tables', run_warns_about_unmapped_and_duplicate_wos),
    ('Run builds Table 1/2 and flags a squad over 80% OPEX', run_builds_tables_and_flags_high_opex),
    ('a squad at exactly 80.00% OPEX gets no Rebalance card', exactly_80_percent_needs_no_rebalance),
    ('Rebalance Apply moves 2 MH to CAPEX, shows before→after, and Undo restores it', apply_then_undo_round_trips_the_timesheet),
    ('"ทำต่อ" runs round 2 when round 1 cannot get under 80%', continue_runs_round_2_when_round_1_is_not_enough),
    ('Apply without "ทำต่อ" only applies round 1 and still offers round 2', apply_without_continue_only_does_round_1),
    ('choosing another CAPEX WO in the dropdown sends the move there', target_wo_dropdown_redirects_the_move),
    ('a person with no role is skipped with a reason and Apply is disabled', people_without_a_role_are_skipped_with_a_reason),
    ('a role missing from Role Ceilings is skipped with a reason', unknown_role_is_skipped_with_a_reason),
    ('an applied rebalance survives a page reload and can still be undone', apply_survives_a_reload),
    ('Copy Timesheet ฉบับใหม่ puts the edited rows (no header) on the clipboard', copy_new_timesheet_puts_rows_on_the_clipboard),
    ('after Apply adds a row, the card says how many rows were added', copy_new_timesheet_warns_about_added_rows),
    ('the downloaded new timesheet .xlsx uploads back with the edits', downloaded_new_timesheet_uploads_back_with_the_edits),
    ('Remaining (เดือนนี้) = last month − this month and syncs to the Mapping grid', remaining_this_month_is_last_month_minus_actual),
    ('ขึ้นเดือนใหม่ rolls this month\'s Remaining into last month', new_month_rolls_this_month_into_last_month),
    ('ขึ้นเดือนใหม่ before Run shows an error banner', new_month_before_run_shows_error),
    ('Download CSV before Run shows an error banner', download_csv_before_run_shows_error),
    ('Table 1/2 Download CSV give dated files with a BOM and the right rows', download_table_csvs),
    ('Copy Table 1 flashes "✓ Copied"', copy_table_flashes_copied),
    ('uploading krungsri.xlsx fills the timesheet grid', upload_sample_xlsx_fills_the_grid),
    ('uploading a file that is not really .xlsx shows an error', upload_non_xlsx_shows_error),
    ('the first visit loads the default WO Mapping, ready to Run', first_visit_loads_the_default_wo_mapping),
    ('the first visit loads the default People → Role list', first_visit_loads_the_default_people_roles),
    ('คืนค่าเริ่มต้น on People → Role replaces the grid with the defaults', people_roles_reset_restores_the_defaults),
    ('an edited mapping replaces the defaults after a reload', an_edited_mapping_replaces_the_defaults_after_a_reload),
    ('mapping, people roles and working days survive a reload', mapping_roles_and_working_days_survive_a_reload),
    ('Clear empties the Mapping grid; a reload brings the defaults back', clear_mapping_empties_the_grid),
    ('a saved-but-empty Mapping / Role Ceilings falls back to the defaults', saved_but_empty_tables_fall_back_to_the_defaults),
    ('คืนค่าเริ่มต้น on WO Mapping replaces the grid with the defaults', mapping_reset_restores_the_defaults),
    ('คืนค่าเริ่มต้น restores the default Role Ceilings', role_ceilings_reset_restores_defaults),
]

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    for name, fn in TESTS:
        test(name, fn, browser)
    browser.close()

print('\n' + (str(failures) + ' of ' + str(len(TESTS)) + ' test(s) failed' if failures else 'all ' + str(len(TESTS)) + ' browser tests passed'))
sys.exit(1 if failures else 0)
