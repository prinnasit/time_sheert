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


def draft_rows(page):
    return page.locator('#rebalance-container table.rb-draft tbody tr')


def draft_field(page, index, field):
    return draft_rows(page).nth(index).locator('[data-field="' + field + '"]')


def download(page, click_selector):
    with page.expect_download() as info:
        click(page, click_selector)
    d = info.value
    path = DOWNLOAD_DIR / d.suggested_filename
    d.save_as(path)
    return d.suggested_filename, path


def paste_mapping(page, mapping):
    # The grid starts with DEFAULT_WO_MAPPING; clear it so only the
    # scenario's own WOs are in play.
    click(page, '#clear-mapping-btn')
    paste_into_grid(page, 'mapping-grid', tsv(mapping))


def setup(page, mapping, timesheet, people=None, working_days='20'):
    paste_mapping(page, mapping)
    paste_into_grid(page, 'timesheet-grid', tsv(timesheet))
    if people:
        paste_into_grid(page, 'people-roles-grid', tsv(people) + '\n')
    fill(page, '#working-days-input', working_days)  # ceilings are scaled by working days / 20
    click(page, '#run-btn')


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


def rebalance_empty_state_text_follows_the_situation(page):
    show(page, 'rebalance')
    expect(page.locator('#rebalance-empty')).to_contain_text('ยังไม่มีผลลัพธ์')           # before any Run
    setup(page, MAPPING, [timesheet_row('Ann', 'S1', 'C1', {1: 8})])                     # nothing over 80%
    show(page, 'rebalance')
    expect(page.locator('#rebalance-empty')).to_contain_text('ไม่มี squad ที่ OPEX เกิน 80%')


def new_month_with_a_squad_over_80_does_not_claim_all_clear(page):
    setup_over_80(page)
    click(page, '#new-month-btn')
    show(page, 'rebalance')
    empty = page.locator('#rebalance-empty')
    expect(empty).to_be_visible()
    expect(empty).to_contain_text('กด Run อีกครั้ง')
    expect(empty).to_contain_text('S1')
    expect(empty).not_to_contain_text('🎉')


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


def run_without_mapping_shows_error(page):
    click(page, '#clear-mapping-btn')
    click(page, '#run-btn')
    expect(page.locator('#banners')).to_contain_text('กรุณาวางตาราง WO Mapping ก่อนกด Run')


def run_without_timesheet_shows_error(page):
    click(page, '#run-btn')  # the default mapping is enough to get past the mapping check
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
    reveal(page, '#rebalance-card')
    expect(page.locator('#rebalance-card')).to_be_visible()
    expect(page.locator('#rebalance-container')).to_contain_text('Dev1')


def result_headers_carry_category_colours_and_the_thai_font_loads(page):
    setup_over_80(page)
    band = page.locator('#table1-container thead tr').first
    expect(band.locator('th.cat-capex')).to_have_text('CAPEX')
    expect(band.locator('th.cat-opex')).to_have_text('OPEX')
    expect(page.locator('#table2-container thead th.cat-capex')).to_have_text('CAPEX %')
    expect(page.locator('#table2-container thead th.cat-opex')).to_have_text('OPEX %')
    font = page.evaluate('getComputedStyle(document.body).fontFamily')
    assert font.startswith('"IBM Plex Sans Thai"'), font


def exactly_80_percent_needs_no_rebalance(page):
    setup(page, MAPPING, [
        timesheet_row('Dev1', 'S1', 'C1', {1: 8, 2: 8}),
        timesheet_row('Dev1', 'S1', 'O1', {d: 8 for d in range(3, 11)}),  # 64 / 80 = 80.00%
    ], DEV1)
    expect(opex_cell(page, 'S1')).to_have_text('80.00%')
    expect(opex_cell(page, 'S1')).not_to_have_class(re.compile('pct-alert'))
    reveal(page, '#rebalance-card')
    expect(page.locator('#rebalance-card')).to_be_hidden()


# ---- Rebalance -------------------------------------------------------------

def apply_then_undo_round_trips_the_timesheet(page):
    setup_over_80(page)
    opex_day11 = grid_cell(page, 'timesheet-grid', 1, day_col(11))
    capex_day11 = grid_cell(page, 'timesheet-grid', 0, day_col(11))
    expect(opex_day11).to_have_value('8')

    click(page, '[data-rb-action="apply"]')
    expect(opex_day11).to_have_value('6')
    expect(capex_day11).to_have_value('2')
    expect(opex_cell(page, 'S1')).to_have_text('79.55%')
    expect(opex_cell(page, 'S1')).not_to_have_class(re.compile('pct-alert'))
    expect(table2_row(page, 'S1').locator('td').nth(3)).to_have_text('81.82%')  # OPEX % (เดิม)
    # Table 1 shows "before → after" on the cells that changed.
    expect(table1_cell(page, 'S1', 'C1')).to_have_text('2.00 → 2.25')
    expect(table1_cell(page, 'S1', 'C1')).to_have_class(re.compile('cell-changed'))
    expect(table1_cell(page, 'S1', 'O1')).to_have_text('9.00 → 8.75')
    log = page.locator('#changelog-container tbody tr')
    expect(log).to_have_count(2)
    expect(log.nth(0).locator('td')).to_have_text(['Dev1', 'S1', 'C1', '11', '', '2', 'Rebalance'])
    expect(log.nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '11', '8', '6', 'Rebalance'])

    click(page, '[data-rb-action="undo"]')
    expect(opex_day11).to_have_value('8')
    expect(capex_day11).to_have_value('')
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')
    expect(table1_cell(page, 'S1', 'C1')).to_have_text('2.00')
    reveal(page, '#changelog-card')
    expect(page.locator('#changelog-card')).to_be_hidden()


def continue_runs_round_2_when_round_1_is_not_enough(page):
    setup(page, MAPPING, NEEDS_ROUND_2, [['Dev4', 'Developer']])
    rebalance = page.locator('#rebalance-container')
    expect(rebalance).to_contain_text('รอบที่ 1')
    reveal(page, '[data-rb-action="continue"]')
    expect(page.locator('[data-rb-action="continue"]')).to_be_visible()

    click(page, '[data-rb-action="continue"]')
    expect(page.locator('[data-rb-action="continue"]')).to_have_count(0)
    expect(page.locator('#rb-draft-preview')).to_contain_text('94.74% → 78.95%')

    click(page, '[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('78.95%')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(4))).to_have_value('')   # 2 MH moved out
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(3))).to_have_value('7')  # round 2's 1 MH
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(4))).to_have_value('2')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(3))).to_have_value('1')


def apply_without_continue_only_does_round_1(page):
    setup(page, MAPPING, NEEDS_ROUND_2, [['Dev4', 'Developer']])
    click(page, '[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('84.21%')
    expect(opex_cell(page, 'S1')).to_have_class(re.compile('pct-alert'))
    # Still over 80%, so the card offers round 2 again plus Undo.
    reveal(page, '[data-rb-action="continue"]')
    expect(page.locator('[data-rb-action="continue"]')).to_be_visible()
    reveal(page, '[data-rb-action="undo"]')
    expect(page.locator('[data-rb-action="undo"]')).to_be_visible()


def target_wo_dropdown_redirects_the_move(page):
    setup_over_80(page)
    expect(draft_field(page, 0, 'toWoKey')).to_have_value('C1')  # Dev1's own CAPEX WO comes first
    select(page, draft_field(page, 0, 'toWoKey'), 'C2')          # a CAPEX WO Dev1 has no row for yet
    expect(draft_field(page, 0, 'toWoKey')).to_have_value('C2')

    click(page, '[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(11))).to_have_value('')  # C1 untouched
    reveal(page, '#changelog-card')
    expect(page.locator('#changelog-card')).to_be_visible()  # Apply has finished re-rendering
    new_row = grid_row_where(page, 'timesheet-grid', 2, 'C2')
    expect(new_row.locator('input').nth(0)).to_have_value('Dev1')
    expect(new_row.locator('input').nth(day_col(11))).to_have_value('2')
    expect(page.locator('#changelog-container tbody tr').nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'C2', '11', '', '2', 'Rebalance'])


def people_without_a_role_are_skipped_with_a_reason(page):
    setup(page, MAPPING, OVER_80)  # no People -> Role rows at all
    expect(page.locator('#rebalance-container')).to_contain_text('ข้ามคนที่ระบบแก้ให้ไม่ได้: Dev1 (ยังไม่ได้ระบุตำแหน่ง)')
    expect(page.locator('[data-rb-action="apply"]')).to_be_disabled()


def unknown_role_is_skipped_with_a_reason(page):
    setup(page, MAPPING, OVER_80, [['Dev1', 'Wizard']])
    expect(page.locator('#rebalance-container')).to_contain_text('ไม่พบตำแหน่ง "Wizard" ในตารางเพดาน')


def draft_lists_the_plan_per_day_with_a_preview(page):
    setup_over_80(page)
    expect(draft_rows(page)).to_have_count(1)
    expect(draft_field(page, 0, 'person')).to_have_value('dev1|S1')
    expect(draft_field(page, 0, 'day')).to_have_value('11')
    expect(draft_field(page, 0, 'mh')).to_have_value('2')
    expect(draft_field(page, 0, 'fromWoKey')).to_have_value('O1')
    expect(draft_field(page, 0, 'toWoKey')).to_have_value('C1')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 79.55%')


def editing_draft_mh_updates_the_preview_and_what_apply_does(page):
    setup_over_80(page)
    mh = draft_field(page, 0, 'mh')
    fill(page, mh, '4')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 77.27%')  # 68 / 88
    assert mh.evaluate('el => el === document.activeElement'), 'typing MH must not re-render the draft table'
    click(page, '[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('4')
    expect(grid_cell(page, 'timesheet-grid', 0, day_col(11))).to_have_value('4')
    expect(page.locator('#changelog-container')).not_to_contain_text('แก้เอง')


def editing_draft_day_moves_a_different_day(page):
    setup_over_80(page)
    select(page, draft_field(page, 0, 'day'), '10')
    click(page, '[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).to_have_value('6')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('8')


def draft_mh_over_the_day_is_an_error_and_blocks_apply(page):
    setup_over_80(page)
    fill(page, draft_field(page, 0, 'mh'), '9')
    expect(draft_rows(page).nth(0)).to_have_class(re.compile('rb-row-error'))
    expect(draft_rows(page).nth(0).locator('td.rb-row-msg')).to_contain_text('วันที่ 11 ของ O1 เหลือให้ย้ายได้ 8 MH')
    expect(page.locator('[data-rb-action="apply"]')).to_be_disabled()
    fill(page, draft_field(page, 0, 'mh'), '2')
    expect(page.locator('[data-rb-action="apply"]')).to_be_enabled()


def deleting_the_only_draft_row_disables_apply(page):
    setup_over_80(page)
    click(page, '[data-rb-action="draft-del"]')
    expect(draft_rows(page)).to_have_count(0)
    expect(page.locator('[data-rb-action="apply"]')).to_be_disabled()
    expect(page.locator('#rb-draft-preview')).to_be_empty()


def adding_a_draft_row_uses_sensible_defaults(page):
    setup_over_80(page)
    click(page, '[data-rb-action="draft-add"]')
    expect(draft_rows(page)).to_have_count(2)
    expect(draft_field(page, 1, 'person')).to_have_value('dev1|S1')
    expect(draft_field(page, 1, 'fromWoKey')).to_have_value('O1')
    expect(draft_field(page, 1, 'toWoKey')).to_have_value('C1')
    expect(draft_field(page, 1, 'day')).to_have_value('11')
    expect(draft_field(page, 1, 'mh')).to_have_value('1')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 78.41%')  # 69 / 88


def changing_the_person_resets_the_row_defaults(page):
    setup(page, MAPPING, OVER_80 + [
        timesheet_row('Ann', 'S1', 'C2', {1: 8}),
        timesheet_row('Ann', 'S1', 'O1', {20: 8, 21: 8, 22: 8, 23: 8}),
    ], DEV1)
    click(page, '[data-rb-action="draft-add"]')
    last = draft_rows(page).count() - 1
    select(page, draft_field(page, last, 'person'), 'ann|S1')
    expect(draft_field(page, last, 'fromWoKey')).to_have_value('O1')
    expect(draft_field(page, last, 'toWoKey')).to_have_value('C2')
    expect(draft_field(page, last, 'day')).to_have_value('23')
    expect(draft_field(page, last, 'mh')).to_have_value('1')


def draft_ceiling_warning_does_not_block_apply(page):
    setup(page, MAPPING, OVER_80, DEV1, working_days='1')  # CAPEX ceiling 16 MD x 1/20 = 0.8 MD
    click(page, '[data-rb-action="draft-add"]')
    expect(draft_rows(page).last.locator('td.rb-row-msg')).to_contain_text('เกินเพดาน')
    expect(page.locator('[data-rb-action="apply"]')).to_be_enabled()


def recalc_discards_draft_edits(page):
    setup_over_80(page)
    fill(page, draft_field(page, 0, 'mh'), '4')
    expect(page.locator('#rb-draft-preview')).to_contain_text('81.82% → 77.27%')
    click(page, '[data-rb-action="recalc"]')
    expect(draft_field(page, 0, 'mh')).to_have_value('2')


def apply_survives_a_reload(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('6')
    page.reload()
    page.wait_for_load_state('networkidle')
    # The edited timesheet and the saved original both come back from
    # localStorage, so Undo must still be reachable after a reload.
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('6')
    click(page, '#run-btn')
    click(page, '[data-rb-action="undo"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('8')


def copy_new_timesheet_puts_rows_on_the_clipboard(page):
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    btn = page.locator('[data-rb-action="copy-new"]')
    click(page, btn)
    expect(btn).to_have_text('✓ Copied 2 แถว')
    lines = page.evaluate('navigator.clipboard.readText()').splitlines()  # Windows' clipboard turns \n into \r\n
    assert len(lines) == 2, lines                            # data rows only, no header
    cells = [line.split('\t') for line in lines]
    assert cells[0][:3] == ['Dev1', 'S1', 'C1'], cells[0][:5]
    assert cells[0][day_col(11)] == '2' and cells[1][day_col(11)] == '6', (cells[0][day_col(11)], cells[1][day_col(11)])
    assert all(len(c) == 36 for c in cells), [len(c) for c in cells]


def summary_row(page, squad):
    return page.locator('#rebalance-container table.rb-summary tbody tr', has=page.locator('td', has_text=re.compile('^' + squad + '$')))


def apply_shows_a_capex_opex_summary_per_squad_in_the_card(page):
    page.context.grant_permissions(['clipboard-read', 'clipboard-write'])
    setup_over_80(page)
    expect(page.locator('#rebalance-container table.rb-summary')).to_have_count(0)  # only after Apply
    click(page, '[data-rb-action="apply"]')
    cells = summary_row(page, 'S1').locator('td')
    expect(cells).to_have_text(['S1', '18.18% → 20.45%', '81.82% → 79.55%'])
    expect(cells.nth(2)).not_to_have_class(re.compile('pct-alert'))

    btn = page.locator('[data-rb-action="copy-summary"]')
    click(page, btn)
    expect(btn).to_have_text('✓ Copied')
    lines = page.evaluate('navigator.clipboard.readText()').splitlines()
    assert lines ==['Squad\tCAPEX % (เดิม)\tCAPEX % (ใหม่)\tOPEX % (เดิม)\tOPEX % (ใหม่)',
                     'S1\t18.18%\t20.45%\t81.82%\t79.55%'], lines

    click(page, '[data-rb-action="undo"]')
    expect(page.locator('#rebalance-container table.rb-summary')).to_have_count(0)


def summary_flags_a_squad_still_over_80(page):
    setup(page, MAPPING, NEEDS_ROUND_2, [['Dev4', 'Developer']])
    click(page, '[data-rb-action="apply"]')  # round 1 only -> 84.21%
    cell = summary_row(page, 'S1').locator('td').nth(2)
    expect(cell).to_have_text('94.74% → 84.21%')
    expect(cell).to_have_class(re.compile('pct-alert'))


def copy_new_timesheet_warns_about_added_rows(page):
    setup_over_80(page)
    select(page, draft_field(page, 0, 'toWoKey'), 'C2')  # Dev1 has no C2 row
    click(page, '[data-rb-action="apply"]')
    expect(page.locator('#rebalance-container')).to_contain_text('มีแถวใหม่ 1 แถวต่อท้าย')


def after_apply_editing_a_cell_refreshes_tables_without_run(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('79.55%')
    fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(10)), '7')  # O1 day 10: 8 -> 7
    fill(page, grid_cell(page, 'timesheet-grid', 0, day_col(10)), '1')  # C1 day 10: blank -> 1
    expect(opex_cell(page, 'S1')).to_have_text('78.41%')         # 69 / 88, no Run click
    expect(summary_row(page, 'S1').locator('td').nth(2)).to_have_text('81.82% → 78.41%')
    log = page.locator('#changelog-container tbody tr')
    expect(log).to_have_count(4)
    expect(log.nth(0).locator('td')).to_have_text(['Dev1', 'S1', 'C1', '10', '', '1', 'แก้เอง'])
    expect(log.nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'C1', '11', '', '2', 'Rebalance'])
    expect(log.nth(2).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '10', '8', '7', 'แก้เอง'])
    expect(log.nth(3).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '11', '8', '6', 'Rebalance'])


def after_apply_changed_cells_are_highlighted_with_the_old_value(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    opex11 = grid_cell(page, 'timesheet-grid', 1, day_col(11))
    capex11 = grid_cell(page, 'timesheet-grid', 0, day_col(11))
    expect(opex11).to_have_class(re.compile('cell-changed'))
    expect(opex11).to_have_attribute('title', 'เดิม: 8')
    expect(capex11).to_have_attribute('title', 'เดิม: ว่าง')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).not_to_have_class(re.compile('cell-changed'))
    fill(page, opex11, '8')   # put the original values back by hand
    fill(page, capex11, '')
    expect(opex11).not_to_have_class(re.compile('cell-changed'))
    reveal(page, '#changelog-card')
    expect(page.locator('#changelog-card')).to_be_hidden()
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')


def editing_over_a_rebalance_cell_counts_as_manual(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(11)), '5')
    expect(page.locator('#changelog-container tbody tr').nth(1).locator('td')).to_have_text(['Dev1', 'S1', 'O1', '11', '8', '5', 'แก้เอง'])


def typing_in_the_timesheet_after_apply_keeps_focus(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    cell = grid_cell(page, 'timesheet-grid', 1, day_col(10))
    click(page, cell)
    page.keyboard.press('Control+A')
    page.keyboard.type('7')
    expect(opex_cell(page, 'S1')).to_have_text('79.31%')  # 69 / 87, after the auto refresh
    assert cell.evaluate('el => el === document.activeElement'), 'focus left the cell after the auto refresh'


def manual_edits_survive_a_reload(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(10)), '7')
    expect(page.locator('#changelog-container')).to_contain_text('แก้เอง')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(page.locator('#changelog-container')).to_contain_text('แก้เอง')
    expect(page.locator('#changelog-container')).to_contain_text('Rebalance')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).to_have_class(re.compile('cell-changed'))


def undo_after_manual_edits_restores_the_original(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(10)), '7')
    expect(opex_cell(page, 'S1')).to_have_text('79.31%')
    click(page, '[data-rb-action="undo"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).to_have_value('8')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_value('8')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(10))).not_to_have_class(re.compile('cell-changed'))
    reveal(page, '#changelog-card')
    expect(page.locator('#changelog-card')).to_be_hidden()


def before_apply_editing_waits_for_run(page):
    setup_over_80(page)
    fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(3)), '0')
    page.wait_for_timeout(700)  # longer than the 300 ms auto refresh would take
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')
    click(page, '#run-btn')
    expect(opex_cell(page, 'S1')).to_have_text('80.00%')  # 64 / 80


def downloaded_new_timesheet_uploads_back_with_the_edits(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
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
    reveal(page, '#rebalance-card')
    expect(page.locator('#rebalance-card')).to_be_hidden()
    reveal(page, '#changelog-card')
    expect(page.locator('#changelog-card')).to_be_hidden()


# ---- Remaining + new month -------------------------------------------------

def editing_back_over_80_after_a_clean_apply_rebuilds_the_draft(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    expect(opex_cell(page, 'S1')).to_have_text('79.55%')
    fill(page, grid_cell(page, 'timesheet-grid', 0, day_col(11)), '')   # put the original values back by hand
    fill(page, grid_cell(page, 'timesheet-grid', 1, day_col(11)), '8')
    expect(opex_cell(page, 'S1')).to_have_text('81.82%')
    expect(draft_rows(page)).to_have_count(1)
    expect(page.locator('[data-rb-action="apply"]')).to_be_enabled()


def new_month_clears_the_yellow_changed_cells(page):
    setup_over_80(page)
    click(page, '[data-rb-action="apply"]')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).to_have_class(re.compile('cell-changed'))
    click(page, '#new-month-btn')
    expect(grid_cell(page, 'timesheet-grid', 1, day_col(11))).not_to_have_class(re.compile('cell-changed'))


def remaining_this_month_is_last_month_minus_actual(page):
    setup_over_80(page)
    fill(page, '#table1-container .remaining-input[data-wo-key="C1"]', '10')
    expect(page.locator('#table1-container .remaining-computed[data-wo-key="C1"]')).to_have_text('8.00')  # 10 - 2.00
    # The same value shows up in the Mapping grid's Remaining column (row 1 = C1).
    expect(grid_cell(page, 'mapping-grid', 0, 3)).to_have_value('10')


def new_month_rolls_this_month_into_last_month(page):
    setup_over_80(page)
    fill(page, '#table1-container .remaining-input[data-wo-key="C1"]', '10')
    click(page, '#new-month-btn')
    expect(page.locator('#new-month-status')).to_contain_text('อัปเดตแล้ว')
    expect(page.locator('#table1-container .remaining-input[data-wo-key="C1"]')).to_have_value('8')
    expect(page.locator('#table1-container .remaining-computed[data-wo-key="C1"]')).to_have_text('6.00')


def new_month_before_run_shows_error(page):
    click(page, '#new-month-btn')
    expect(page.locator('#banners')).to_contain_text('กรุณากด Run ก่อนขึ้นเดือนใหม่')


# ---- Export ----------------------------------------------------------------

def download_csv_before_run_shows_error(page):
    click(page, '#download-table1-btn')
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
    click(page, '#copy-table1-btn')
    expect(page.locator('#copy-table1-btn')).to_have_text('✓ Copied')


# ---- Upload ----------------------------------------------------------------

def upload_sample_xlsx_fills_the_grid(page):
    page.set_input_files('#xlsx-upload', str(SAMPLE_XLSX))
    expect(page.locator('#upload-status')).to_have_text(re.compile(r'^Loaded [1-9]\d* row\(s\) from krungsri\.xlsx$'))
    expect(grid_cell(page, 'timesheet-grid', 0, 0)).not_to_have_value('')


def upload_non_xlsx_shows_error(page):
    page.set_input_files('#xlsx-upload', {'name': 'notes.xlsx', 'mimeType': 'text/plain', 'buffer': b'just some text'})
    expect(page.locator('#upload-status')).to_contain_text('ไฟล์นี้ดูไม่ใช่ไฟล์ Excel')


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
    click(page, '#run-btn')
    expect(table1_cell(page, 'S1', 'WO-01')).to_have_text('1.00')
    expect(page.locator('#banners')).to_be_empty()


def first_visit_loads_the_default_people_roles(page):
    expect(grid_cell(page, 'people-roles-grid', 0, 0)).to_have_value('Person 01')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Head of Innovation')
    expect(grid_cell(page, 'people-roles-grid', 9, 0)).to_have_value('Person 10')
    expect(grid_cell(page, 'people-roles-grid', 9, 1)).to_have_value('Developer')
    expect(grid_cell(page, 'people-roles-grid', 36, 0)).to_have_value('Person 37')


def people_roles_reset_restores_the_defaults(page):
    fill(page, grid_cell(page, 'people-roles-grid', 0, 1), 'Developer')
    click(page, '#people-roles-reset-btn')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Head of Innovation')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Head of Innovation')


def an_edited_mapping_replaces_the_defaults_after_a_reload(page):
    fill(page, grid_cell(page, 'mapping-grid', 0, 2), 'Renamed WO')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 0, 2)).to_have_value('Renamed WO')


def mapping_roles_and_working_days_survive_a_reload(page):
    paste_mapping(page, MAPPING)
    paste_into_grid(page, 'people-roles-grid', tsv(DEV1) + '\n')
    fill(page, '#working-days-input', '18')
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 1, 0)).to_have_value('C2')
    expect(grid_cell(page, 'mapping-grid', 1, 1)).to_have_value('CAPEX')
    expect(grid_cell(page, 'people-roles-grid', 0, 1)).to_have_value('Developer')
    expect(page.locator('#working-days-input')).to_have_value('18')


def clear_mapping_empties_the_grid(page):
    click(page, '#clear-mapping-btn')
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
    click(page, '#mapping-reset-btn')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')
    expect(grid_cell(page, 'mapping-grid', 4, 0)).to_have_value('WO-05')  # pasted rows are gone, not merged
    page.reload()
    page.wait_for_load_state('networkidle')
    expect(grid_cell(page, 'mapping-grid', 0, 0)).to_have_value('WO-01')


def role_ceilings_reset_restores_defaults(page):
    fill(page, grid_row_where(page, 'role-ceilings-grid', 0, 'Developer').locator('input').nth(3), '99')
    page.reload()
    page.wait_for_load_state('networkidle')
    # The edit is remembered across reloads...
    expect(grid_row_where(page, 'role-ceilings-grid', 0, 'Developer').locator('input').nth(3)).to_have_value('99')
    # ...until คืนค่าเริ่มต้น puts the default (Developer OPEX = 2 MD) back.
    click(page, '#role-ceilings-reset-btn')
    expect(grid_row_where(page, 'role-ceilings-grid', 0, 'Developer').locator('input').nth(3)).to_have_value('2')


def switching_tabs_scrolls_back_to_the_top(page):
    page.set_viewport_size({'width': 1280, 'height': 400})
    show(page, 'timesheet')
    page.evaluate('window.scrollTo(0, document.body.scrollHeight)')
    assert page.evaluate('window.scrollY') > 0, 'the Timesheet tab should be tall enough to scroll'
    show(page, 'results')
    assert page.evaluate('window.scrollY') == 0, 'switching tab must scroll to the top'


def run_from_the_bottom_shows_the_results_from_the_top(page):
    page.set_viewport_size({'width': 1280, 'height': 500})
    paste_mapping(page, MAPPING)
    paste_into_grid(page, 'timesheet-grid', tsv(OVER_80))
    fill(page, '#working-days-input', '20')
    show(page, 'timesheet')
    page.locator('#run-btn').scroll_into_view_if_needed()
    click(page, '#run-btn')
    expect(view_el(page, 'results')).to_be_visible()
    expect(page.locator('#kpi-tiles')).to_be_in_viewport()


TESTS = [
    ('the first visit shows only the Timesheet tab', first_visit_shows_only_the_timesheet_tab),
    ('tabs follow the URL hash across a reload and the Back button', tabs_follow_the_hash_across_reload_and_back),
    ('a successful Run jumps to ผลลัพธ์; a Run error stays on Timesheet', run_success_jumps_to_results_but_errors_stay),
    ('ผลลัพธ์ and แก้เกิน 80% show an empty state before any Run', empty_states_show_before_any_run),
    ('switching tabs scrolls the window back to the top', switching_tabs_scrolls_back_to_the_top),
    ('a Run from the bottom of Timesheet shows the results from the top', run_from_the_bottom_shows_the_results_from_the_top),
    ('ผลลัพธ์ shows 4 KPI tiles, an over-80% banner and a ไปแก้ link to tab 3', results_show_kpis_and_a_link_to_fix_over_80),
    ('the badge and banner clear once no squad is over 80%', badge_and_banner_clear_once_nothing_is_over_80),
    ('แก้เกิน 80% shows its empty state when no squad is over', no_squad_over_80_shows_the_rebalance_empty_state),
    ('the แก้เกิน 80% empty-state text follows the situation', rebalance_empty_state_text_follows_the_situation),
    ('after ขึ้นเดือนใหม่ the empty state does not claim all clear while a squad is over 80%', new_month_with_a_squad_over_80_does_not_claim_all_clear),
    ('after Apply the Timesheet tab says how many cells changed, gone after Undo', timesheet_strip_counts_changed_cells_after_apply),
    ('Run with an empty mapping shows an error banner', run_without_mapping_shows_error),
    ('Run with an empty timesheet shows an error banner', run_without_timesheet_shows_error),
    ('Run warns about unmapped and duplicate WOs but still builds the tables', run_warns_about_unmapped_and_duplicate_wos),
    ('Run builds Table 1/2 and flags a squad over 80% OPEX', run_builds_tables_and_flags_high_opex),
    ('result headers carry category colour classes and the Thai font is set', result_headers_carry_category_colours_and_the_thai_font_loads),
    ('a squad at exactly 80.00% OPEX gets no Rebalance card', exactly_80_percent_needs_no_rebalance),
    ('Rebalance Apply moves 2 MH to CAPEX, shows before→after, and Undo restores it', apply_then_undo_round_trips_the_timesheet),
    ('"ทำต่อ" runs round 2 when round 1 cannot get under 80%', continue_runs_round_2_when_round_1_is_not_enough),
    ('Apply without "ทำต่อ" only applies round 1 and still offers round 2', apply_without_continue_only_does_round_1),
    ('choosing another CAPEX WO in the dropdown sends the move there', target_wo_dropdown_redirects_the_move),
    ('a person with no role is skipped with a reason and Apply is disabled', people_without_a_role_are_skipped_with_a_reason),
    ('a role missing from Role Ceilings is skipped with a reason', unknown_role_is_skipped_with_a_reason),
    ('the draft lists the plan per day with an "ถ้า Apply ตามนี้" preview', draft_lists_the_plan_per_day_with_a_preview),
    ('editing draft MH updates the preview and what Apply writes', editing_draft_mh_updates_the_preview_and_what_apply_does),
    ('editing the draft day moves hours on that day instead', editing_draft_day_moves_a_different_day),
    ('draft MH over what the day holds is an error and blocks Apply', draft_mh_over_the_day_is_an_error_and_blocks_apply),
    ('deleting the only draft row empties the preview and disables Apply', deleting_the_only_draft_row_disables_apply),
    ('+ เพิ่มการย้าย adds a row with sensible defaults', adding_a_draft_row_uses_sensible_defaults),
    ('changing a draft row\'s person resets its from/to/day/MH', changing_the_person_resets_the_row_defaults),
    ('a CAPEX-ceiling warning in the draft does not block Apply', draft_ceiling_warning_does_not_block_apply),
    ('คำนวณคำแนะนำใหม่ throws away draft edits', recalc_discards_draft_edits),
    ('an applied rebalance survives a page reload and can still be undone', apply_survives_a_reload),
    ('Copy Timesheet ฉบับใหม่ puts the edited rows (no header) on the clipboard', copy_new_timesheet_puts_rows_on_the_clipboard),
    ('after Apply adds a row, the card says how many rows were added', copy_new_timesheet_warns_about_added_rows),
    ('after Apply the card shows CAPEX/OPEX % per squad (เดิม → ใหม่) with a Copy button', apply_shows_a_capex_opex_summary_per_squad_in_the_card),
    ('the summary flags a squad that is still over 80% in red', summary_flags_a_squad_still_over_80),
    ('after Apply, editing a timesheet cell refreshes Table 2 / summary / history without Run', after_apply_editing_a_cell_refreshes_tables_without_run),
    ('after Apply, changed cells are yellow with "เดิม: …", and clear when typed back', after_apply_changed_cells_are_highlighted_with_the_old_value),
    ('typing over a cell Rebalance changed is logged as แก้เอง', editing_over_a_rebalance_cell_counts_as_manual),
    ('the auto refresh after Apply keeps focus in the cell being typed in', typing_in_the_timesheet_after_apply_keeps_focus),
    ('manual edits and their history survive a reload', manual_edits_survive_a_reload),
    ('Undo after manual edits restores the original timesheet', undo_after_manual_edits_restores_the_original),
    ('before Apply, editing the timesheet still waits for Run', before_apply_editing_waits_for_run),
    ('the downloaded new timesheet .xlsx uploads back with the edits', downloaded_new_timesheet_uploads_back_with_the_edits),
    ('editing back over 80% after a clean Apply rebuilds the draft', editing_back_over_80_after_a_clean_apply_rebuilds_the_draft),
    ('ขึ้นเดือนใหม่ clears the yellow changed cells', new_month_clears_the_yellow_changed_cells),
    ('Remaining (เดือนนี้) = last month − this month and syncs to the Mapping grid', remaining_this_month_is_last_month_minus_actual),
    ('ขึ้นเดือนใหม่ rolls this month\'s Remaining into last month', new_month_rolls_this_month_into_last_month),
    ('ขึ้นเดือนใหม่ before Run shows an error banner', new_month_before_run_shows_error),
    ('Download CSV before Run shows an error banner', download_csv_before_run_shows_error),
    ('Table 1/2 Download CSV give dated files with a BOM and the right rows', download_table_csvs),
    ('Copy Table 1 flashes "✓ Copied"', copy_table_flashes_copied),
    ('uploading krungsri.xlsx fills the timesheet grid', upload_sample_xlsx_fills_the_grid),
    ('uploading a file that is not really .xlsx shows an error', upload_non_xlsx_shows_error),
    ('dropping a file on the dropzone goes through the upload handler', dropping_a_file_on_the_dropzone_uses_the_upload_handler),
    ('dragging over the dropzone highlights it until the drag leaves', dragging_over_the_dropzone_highlights_it),
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
