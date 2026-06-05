"""Post-generation HTML safety transforms — applied after LLM output regardless of content."""
from __future__ import annotations

import re
import logging

logger = logging.getLogger("slidant.sanitizer")

# 표 탈출구: 컬럼 수별 고정 너비 (합계 ≤ 840px)
_COL_WIDTHS = {
    2: [360, 480],
    3: [240, 300, 300],
    4: [180, 220, 220, 220],
    5: [140, 180, 180, 170, 170],
}
_TABLE_CONTAINER_TOP = 150
_TABLE_ROW_H = 52
_TABLE_HEADER_H = 44
_TABLE_MAX_BOTTOM = 500


def _inject_style(style: str, additions: dict[str, str]) -> str:
    """Add CSS properties only if not already present."""
    props: dict[str, str] = {}
    for part in (style or "").split(";"):
        part = part.strip()
        if ":" in part:
            k, _, v = part.partition(":")
            props[k.strip().lower()] = v.strip()
    for k, v in additions.items():
        if k not in props:
            props[k] = v
    return "; ".join(f"{k}: {v}" for k, v in props.items() if v)


def _count_table_cols(html: str) -> int:
    """Count number of th/td in first tr."""
    m = re.search(r'<tr[^>]*>(.*?)</tr>', html, re.DOTALL | re.IGNORECASE)
    if not m:
        return 4
    row = m.group(1)
    cells = re.findall(r'<(?:th|td)', row, re.IGNORECASE)
    return max(1, len(cells))


def _extract_cell_text(cell_html: str) -> str:
    """Strip tags, return plain text content."""
    return re.sub(r'<[^>]+>', '', cell_html).strip()


def _rebuild_table(table_outer_html: str) -> str:
    """표 탈출구: LLM이 생성한 table을 Python에서 완전히 재구성.

    - 컬럼 수 강제 캡 (max 5)
    - 고정 너비 재배정 (합계 = 840px)
    - 각 셀에 overflow:hidden; white-space:nowrap 강제
    - 행 높이 고정 (header 44px, data 52px)
    - max_rows 초과 행 잘라냄
    """
    try:
        # thead 추출
        thead_m = re.search(r'<thead[^>]*>(.*?)</thead>', table_outer_html, re.DOTALL | re.IGNORECASE)
        tbody_m = re.search(r'<tbody[^>]*>(.*?)</tbody>', table_outer_html, re.DOTALL | re.IGNORECASE)

        thead_html = thead_m.group(1) if thead_m else ""
        tbody_html = tbody_m.group(1) if tbody_m else ""

        # thead가 없으면 첫 번째 tr을 헤더로
        if not thead_html:
            first_tr = re.search(r'(<tr[^>]*>.*?</tr>)', table_outer_html, re.DOTALL | re.IGNORECASE)
            if first_tr:
                thead_html = first_tr.group(1)
                tbody_html = table_outer_html[first_tr.end():]

        # 헤더 행 파싱
        header_cells: list[str] = re.findall(r'<(?:th|td)[^>]*>(.*?)</(?:th|td)>', thead_html, re.DOTALL | re.IGNORECASE)
        n_cols = max(1, min(5, len(header_cells)))  # 5컬럼 하드 캡

        # 컬럼별 헤더 텍스트
        header_texts = [_extract_cell_text(c) for c in header_cells[:n_cols]]

        # 헤더 컬럼 색상 추출 (기존 스타일 보존)
        header_styles: list[str] = []
        for cell in re.finditer(r'<(?:th|td)([^>]*)>(.*?)</(?:th|td)>', thead_html, re.DOTALL | re.IGNORECASE):
            attrs = cell.group(1)
            sm = re.search(r'style\s*=\s*"([^"]*)"', attrs)
            style = sm.group(1) if sm else ""
            cm = re.search(r'color\s*:\s*(#[0-9a-fA-F]{3,8}|[a-z]+)', style)
            header_styles.append(cm.group(1) if cm else "#9CA3AF")
            if len(header_styles) >= n_cols:
                break
        while len(header_styles) < n_cols:
            header_styles.append("#9CA3AF")

        # 데이터 행 파싱
        data_rows: list[list[str]] = []
        for tr in re.finditer(r'<tr[^>]*>(.*?)</tr>', tbody_html, re.DOTALL | re.IGNORECASE):
            cells = re.findall(r'<(?:th|td)[^>]*>(.*?)</(?:th|td)>', tr.group(1), re.DOTALL | re.IGNORECASE)
            if cells:
                row_texts = [_extract_cell_text(c) for c in cells[:n_cols]]
                # 컬럼 수 맞춤
                while len(row_texts) < n_cols:
                    row_texts.append("")
                data_rows.append(row_texts)

        # max_rows 계산
        available = _TABLE_MAX_BOTTOM - _TABLE_CONTAINER_TOP - _TABLE_HEADER_H
        max_rows = max(2, available // _TABLE_ROW_H)
        if len(data_rows) > max_rows:
            logger.info("[table_escape] trimming %d → %d rows", len(data_rows), max_rows)
            data_rows = data_rows[:max_rows]

        # 컬럼 너비
        col_widths = _COL_WIDTHS.get(n_cols)
        if not col_widths:
            per = 840 // n_cols
            col_widths = [per] * n_cols
            col_widths[-1] = 840 - per * (n_cols - 1)

        # 셀 공통 스타일
        cell_safe = "overflow:hidden;white-space:nowrap;text-overflow:ellipsis;padding:8px 10px;"

        # 헤더 재구성
        header_row_cells = "".join(
            f'<th style="width:{col_widths[i]}px;{cell_safe}text-align:{"left" if i==0 else "center"};'
            f'color:{header_styles[i]};font-weight:700;font-size:13px">{t}</th>'
            for i, t in enumerate(header_texts)
        )
        new_thead = (
            f'<thead><tr style="height:{_TABLE_HEADER_H}px;border-bottom:2px solid #3B82F6">'
            f'{header_row_cells}</tr></thead>'
        )

        # 데이터 행 재구성
        data_row_html = ""
        for ri, row in enumerate(data_rows):
            bg = "background:rgba(255,255,255,0.03);" if ri % 2 == 0 else ""
            cells_html = "".join(
                f'<td style="width:{col_widths[i]}px;{cell_safe}text-align:{"left" if i==0 else "center"};'
                f'color:#F9FAFB;font-size:13px">{t}</td>'
                for i, t in enumerate(row)
            )
            data_row_html += (
                f'<tr style="height:{_TABLE_ROW_H}px;border-bottom:1px solid rgba(255,255,255,0.07);{bg}">'
                f'{cells_html}</tr>'
            )

        new_tbody = f'<tbody>{data_row_html}</tbody>'
        total_w = sum(col_widths)
        new_table = (
            f'<table style="width:{total_w}px;table-layout:fixed;border-collapse:collapse;'
            f'font-family:system-ui,sans-serif">{new_thead}{new_tbody}</table>'
        )
        return new_table

    except Exception as exc:
        logger.warning("[table_escape] rebuild failed: %s — returning original", exc)
        return table_outer_html


def _apply_table_escape(html: str) -> str:
    """Find all <table>...</table> blocks and rebuild them."""
    def replace_table(m: re.Match) -> str:
        return _rebuild_table(m.group(0))

    return re.sub(r'<table[\s\S]*?</table>', replace_table, html, flags=re.IGNORECASE)


def sanitize_slide_html(html: str) -> str:
    """Apply CSS overflow safety to generated slide HTML.

    1. 표 탈출구: table 완전 재구성 (컬럼 캡, 고정 너비, overflow 강제)
    2. th/td: overflow:hidden + nowrap + ellipsis
    3. position:absolute 콘텐츠 div: overflow:hidden 주입
    """
    if not html or "<div" not in html:
        return html

    try:
        # ── 1. 표 탈출구 ───────────────────────────────────────────────────────
        if "<table" in html.lower():
            html = _apply_table_escape(html)

        # ── 2. th/td (잔여 테이블 안전장치) ───────────────────────────────────
        def fix_cell(m: re.Match) -> str:
            tag = m.group(1)
            attrs = m.group(2) or ""
            content = m.group(3)
            close = m.group(4)

            style_m = re.search(r'style\s*=\s*"([^"]*)"', attrs)
            if style_m:
                old_style = style_m.group(1)
                new_style = _inject_style(old_style, {
                    "overflow": "hidden",
                    "white-space": "nowrap",
                    "text-overflow": "ellipsis",
                    "max-width": "0",
                })
                attrs = attrs[:style_m.start()] + f'style="{new_style}"' + attrs[style_m.end():]
            else:
                attrs += ' style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:0"'

            return f"<{tag}{attrs}>{content}</{close}>"

        html = re.sub(
            r'<(th|td)(\s[^>]*)?>([^<]*)</(th|td)>',
            fix_cell,
            html,
            flags=re.DOTALL,
        )

        # ── 3. position:absolute 콘텐츠 div ───────────────────────────────────
        def fix_abs_div(m: re.Match) -> str:
            attrs = m.group(1)
            style_m = re.search(r'style\s*=\s*"([^"]*)"', attrs)
            if not style_m:
                return m.group(0)

            style = style_m.group(1)
            style_norm = style.replace(" ", "").lower()

            is_absolute  = "position:absolute" in style_norm
            has_width    = bool(re.search(r'width\s*:\s*\d', style))
            has_height   = bool(re.search(r'height\s*:\s*\d', style))
            is_slide_root = "width:960px" in style_norm and "height:540px" in style_norm
            is_full_bg    = "inset:0" in style_norm

            if not (is_absolute and has_width and has_height) or is_slide_root or is_full_bg:
                return m.group(0)

            new_style = _inject_style(style, {"overflow": "hidden"})
            new_attrs = attrs[:style_m.start()] + f'style="{new_style}"' + attrs[style_m.end():]
            return f"<div{new_attrs}>"

        html = re.sub(r'<div(\s[^>]*)?>', fix_abs_div, html)

        return html

    except Exception as exc:
        logger.warning("sanitize_slide_html failed (returning original): %s", exc)
        return html
