"""Dynamic pixel budget calculator — injected into LLM prompt before slide generation.

살아있는 제약 명세: LLM에게 추상적 규칙 대신 이 슬라이드의 실제 픽셀 예산을 주입.
LLM은 공간을 상상하는 대신 구체적 수치를 채워 넣기만 하면 된다.
"""
from __future__ import annotations

CANVAS_W = 960
CANVAS_H = 540
SAFE_TOP = 140      # title+divider 아래 content 시작
SAFE_BOTTOM = 500   # footer zone 위 content 끝
SAFE_LEFT = 60
SAFE_RIGHT = 900
BODY_H = SAFE_BOTTOM - SAFE_TOP   # 360px
BODY_W = SAFE_RIGHT - SAFE_LEFT   # 840px


def compute_layout_budget(spec: dict, all_specs: list | None = None) -> str:
    """슬라이드 spec에서 실제 사용 가능 픽셀 예산 계산 → 프롬프트 주입용 문자열 반환."""
    layout = (spec.get("layout") or "CONTENT").upper()
    key_points = spec.get("key_points") or []
    n_items = len(key_points)

    lines = ["\n━━ DYNAMIC PIXEL BUDGET (use these EXACT values — do NOT use different numbers) ━━"]

    if layout == "TABLE":
        _table_budget(lines, key_points, n_items)
    elif layout == "TOC":
        _toc_budget(lines, key_points, all_specs)
    elif layout in ("CONTENT", "DATA", "STATS"):
        _content_budget(lines, n_items)
    elif layout == "SPLIT":
        _split_budget(lines, n_items)
    # 카드 행 레이아웃 힌트 (레이아웃 무관, 항목 수 있으면 항상 추가)
    if n_items >= 2 and layout not in ("TABLE", "TOC", "COVER", "CLOSING"):
        _row_card_budget(lines, n_items)

    lines.append("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return "\n".join(lines) + "\n"


def _table_budget(lines: list, key_points: list, n_items: int) -> None:
    # 컬럼 수 추정: 첫 key_point에서 파이프/탭 구분자 감지
    cols = 4
    if key_points:
        first = str(key_points[0])
        if "|" in first:
            cols = len(first.split("|"))
        elif "\t" in first:
            cols = len(first.split("\t"))

    cols = min(cols, 5)  # 하드 캡 5컬럼
    col_w = BODY_W // cols

    title_end = 150
    header_h = 44
    row_h = 52
    available_for_rows = SAFE_BOTTOM - title_end - header_h
    max_rows = max(3, available_for_rows // row_h)

    lines += [
        f"TABLE — {cols} columns × {max_rows} max rows:",
        f"  container: left=60 top={title_end} width=840 overflow:hidden",
        f"  table CSS: width:840px; table-layout:fixed; border-collapse:collapse",
        f"  each <th>/<td>: width:{col_w}px (sum={cols * col_w}px ≤ 840)",
        f"  header row: height:{header_h}px",
        f"  data row: height:{row_h}px — DO NOT let rows auto-expand past this",
        f"  max data rows: {max_rows} — truncate if data exceeds this",
        f"  ALL <th>/<td> must have: overflow:hidden; white-space:nowrap; text-overflow:ellipsis",
        f"  bottom of last row: {title_end + header_h + max_rows * row_h}px ≤ {SAFE_BOTTOM} ✓",
    ]
    if n_items > max_rows:
        lines.append(f"  ⚠ {n_items} rows requested but max={max_rows} — show only first {max_rows}")


def _toc_budget(lines: list, key_points: list, all_specs: list | None) -> None:
    # TOC 항목 수 추정
    if key_points:
        n = len(key_points)
    elif all_specs:
        n = max(len(all_specs) - 1, 1)
    else:
        n = 5

    title_bottom = 148  # CONTENTS + 목차 제목 + 구분선
    body_h = SAFE_BOTTOM - title_bottom  # ~352px

    if n <= 5:
        cols = 1
        per_col = n
    else:
        cols = 2
        per_col = (n + 1) // 2  # 왼쪽 컬럼: ceil(n/2)

    gap = max(40, (body_h - 10) // per_col)
    gap = min(gap, 72)
    start_y = title_bottom + 8

    num_size = max(26, 44 - n * 2)
    title_size = max(16, 28 - n)

    left_last_top = start_y + (per_col - 1) * gap
    left_last_bottom = left_last_top + num_size + 10

    lines += [
        f"TOC — {n} items ({'2-column' if cols == 2 else '1-column'}):",
        f"  start_y: {start_y}px",
        f"  gap per item: {gap}px",
        f"  number font-size: {num_size}px",
        f"  title font-size: {title_size}px",
    ]
    if cols == 2:
        right_start = per_col + 1
        lines += [
            f"  LEFT col: items 1–{per_col}, left=60, width=380",
            f"  RIGHT col: items {right_start}–{n}, left=500, width=400",
            f"  Left col last item: top={left_last_top}px, bottom≈{left_last_bottom}px ≤ {SAFE_BOTTOM} ✓",
        ]
    else:
        last_top = start_y + (n - 1) * gap
        last_bottom = last_top + num_size + 10
        lines.append(f"  Last item: top={last_top}px, bottom≈{last_bottom}px ≤ {SAFE_BOTTOM}")

    lines.append(
        f"  ⚠ subtitle/footer: place at y=115–140px (ABOVE items), NOT at bottom"
    )

    if left_last_bottom > SAFE_BOTTOM:
        reduced_size = max(20, num_size - 4)
        lines.append(
            f"  ⚠ OVERFLOW RISK — reduce number font to {reduced_size}px or gap to {gap - 4}px"
        )


def _content_budget(lines: list, n_items: int) -> None:
    if n_items == 0:
        lines.append("CONTENT: 0 bullet items — place main content freely in 140–500px zone")
        return

    start_y = 165
    max_bottom = 496
    available = max_bottom - start_y  # 331px

    if n_items <= 6:
        two_col = False
        gap = max(38, int(available / (n_items + 0.2)))
        gap = min(gap, 60)
        font = max(16, 22 - max(0, n_items - 4))
        last_top = start_y + (n_items - 1) * gap
        last_bottom = last_top + int(font * 1.5) + 6
    else:
        two_col = True
        per_col = (n_items + 1) // 2
        gap = max(36, int(available / (per_col + 0.2)))
        gap = min(gap, 55)
        font = max(15, 19 - max(0, per_col - 3))
        last_top = start_y + (per_col - 1) * gap
        last_bottom = last_top + int(font * 1.5) + 6

    if two_col:
        per_col = (n_items + 1) // 2
        lines += [
            f"CONTENT 2-column — {n_items} items ({per_col} left, {n_items - per_col} right):",
            f"  LEFT col:  left=60,  width=380, items 1–{per_col}",
            f"  RIGHT col: left=480, width=400, items {per_col + 1}–{n_items}",
            f"  start_y: {start_y}px, gap: {gap}px, font-size: {font}px",
            f"  left col last item: top={last_top}px, bottom≈{last_bottom}px ≤ 496",
        ]
    else:
        lines += [
            f"CONTENT — {n_items} items:",
            f"  start_y: {start_y}px, gap: {gap}px, font-size: {font}px",
            f"  last item: top={last_top}px, bottom≈{last_bottom}px ≤ 496",
        ]
    if last_bottom > 498:
        lines.append(
            f"  ⚠ OVERFLOW — reduce gap to {int(available / n_items)}px or switch to 2-column"
        )


def _split_budget(lines: list, n_items: int) -> None:
    lines += [
        "SPLIT layout:",
        "  Left panel: left=0, width=440, clip at diagonal ~420px",
        "  Left text zone: left=60, width=320 (right edge ≤ 380px)",
        "  Right text zone: left=500, width=420 (right edge ≤ 920px)",
        "  Gap between panels: ≥80px — never place text in 380–500px range",
        "  Both sides need independent title elements within their own zone",
    ]
    if n_items > 0:
        font = max(16, 20 - max(0, n_items - 3))
        lines.append(f"  Right side bullet font: {font}px (based on {n_items} items)")


def _row_card_budget(lines: list, n_items: int) -> None:
    """카드/행 반복 레이아웃 컬럼 그리드 힌트."""
    row_start = 155
    available = SAFE_BOTTOM - row_start  # 345px
    row_h = max(60, min(110, available // n_items))
    last_bottom = row_start + n_items * row_h

    lines += [
        f"\nROW/CARD COLUMN GRID — {n_items} rows:",
        f"  row_start_y: {row_start}px",
        f"  row_height:  {row_h}px (uniform — every row uses EXACTLY this gap)",
        f"  last row bottom: {last_bottom}px ({'✓' if last_bottom <= SAFE_BOTTOM else '⚠ reduce row_h'})",
        f"  COLUMN LEFT VALUES (pick ONE set and use identically for every row):",
        f"    3-col: col1=left:80  col2=left:320  col3=left:720",
        f"    4-col: col1=left:80  col2=left:260  col3=left:520  col4=left:760",
        f"  ⚠ Every row's same column must have the SAME left value — no per-row deviation",
    ]
