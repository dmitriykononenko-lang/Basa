import os
import sys
import logging
from datetime import datetime
from typing import List, Dict, Any
from dataclasses import dataclass, field

import requests
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import mm
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

API_KEY      = os.environ.get("ADESK_API_KEY", "")
CLIENT_NAME  = os.environ.get("ADESK_CLIENT", "")
AUDITOR_NAME = os.environ.get("ADESK_AUDITOR", "Дмитрий Кононенко")
DATE_FROM    = os.environ.get("ADESK_DATE_FROM", "2026-03-01")
DATE_TO      = os.environ.get("ADESK_DATE_TO", "2026-04-06")
OUTPUT_DIR   = os.environ.get("ADESK_OUTPUT_DIR", ".")
BASE_URL     = "https://api.adesk.ru/v1"

ACCENT       = colors.HexColor("#E60000")
ACCENT_LIGHT = colors.HexColor("#FFF5F5")
GRAY_LIGHT   = colors.HexColor("#F7F7F7")
GRAY_MID     = colors.HexColor("#DDDDDD")
FONT_NORMAL  = "DejaVu"
FONT_BOLD    = "DejaVuBold"

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Font registration
# ---------------------------------------------------------------------------

def register_fonts():
    global FONT_NORMAL, FONT_BOLD
    try:
        pdfmetrics.registerFont(
            TTFont("DejaVu", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf")
        )
        pdfmetrics.registerFont(
            TTFont("DejaVuBold", "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf")
        )
    except Exception:
        FONT_NORMAL = "Helvetica"
        FONT_BOLD   = "Helvetica-Bold"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def fmt_amount(v) -> str:
    try:
        n = float(v or 0)
        parts = f"{abs(n):,.2f}".replace(",", " ")
        return f"-{parts} ₽" if n < 0 else f"{parts} ₽"
    except Exception:
        return str(v)


def fmt_date(v) -> str:
    if not v:
        return "—"
    return str(v)[:10]


def get_user(t: dict) -> str:
    u = t.get("user") or t.get("author") or {}
    if isinstance(u, dict):
        return u.get("name") or u.get("full_name") or u.get("email") or "—"
    return t.get("user_name") or (str(u) if u else "—")

# ---------------------------------------------------------------------------
# AdeskClient
# ---------------------------------------------------------------------------

class AdeskClient:
    def __init__(self, api_key: str):
        self.session = requests.Session()
        self.session.params = {"api_token": api_key}

    def _get(self, endpoint: str, **params) -> Any:
        url = f"{BASE_URL}/{endpoint.lstrip('/')}"
        r = self.session.get(url, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def _unwrap(self, data: Any, hint: str = "") -> List[dict]:
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            for key in [hint, "data", "items", "results"]:
                if key and key in data and isinstance(data[key], list):
                    return data[key]
            for v in data.values():
                if isinstance(v, list):
                    return v
        return []

    def _get_paginated(self, endpoint: str, hint: str = "", **params) -> List[dict]:
        result, offset, limit = [], 0, 500
        while True:
            data = self._get(endpoint, limit=limit, offset=offset, **params)
            page = self._unwrap(data, hint)
            result.extend(page)
            if len(page) < limit:
                break
            offset += limit
        return result

    def get_bank_accounts(self) -> List[dict]:
        return self._get_paginated("bankaccounts", "bankaccounts")

    def get_transactions(
        self, date_from: str, date_to: str, include_deleted: bool = False
    ) -> List[dict]:
        params: Dict[str, Any] = {"date_from": date_from, "date_to": date_to}
        if include_deleted:
            params["is_deleted"] = 1
        return self._get_paginated("transactions", "transactions", **params)

    def get_categories(self) -> List[dict]:
        return self._get_paginated("transactions/categories", "categories")

    def get_projects(self) -> List[dict]:
        return self._get_paginated("projects", "projects")

# ---------------------------------------------------------------------------
# AuditResult
# ---------------------------------------------------------------------------

@dataclass
class AuditResult:
    accounts:               List[dict] = field(default_factory=list)
    deleted_ops:            List[dict] = field(default_factory=list)
    closed_period_edits:    List[dict] = field(default_factory=list)
    manual_ops:             List[dict] = field(default_factory=list)
    no_category_ops:        List[dict] = field(default_factory=list)
    completed_project_ops:  List[dict] = field(default_factory=list)
    balance_discrepancies:  List[dict] = field(default_factory=list)
    total_transactions:     int = 0

# ---------------------------------------------------------------------------
# analyze()
# ---------------------------------------------------------------------------

def analyze(client: AdeskClient, date_from: str, date_to: str) -> AuditResult:
    result = AuditResult()

    log.info("Загрузка счетов…")
    result.accounts = client.get_bank_accounts()

    log.info("Загрузка активных транзакций…")
    active_txns = client.get_transactions(date_from, date_to, include_deleted=False)

    log.info("Загрузка удалённых транзакций…")
    deleted_txns = client.get_transactions(date_from, date_to, include_deleted=True)
    result.total_transactions = len(active_txns)

    log.info("Загрузка проектов…")
    projects_raw = client.get_projects()
    closed_statuses = {"closed", "finished", "completed"}
    project_map: Dict[Any, dict] = {}
    for p in projects_raw:
        pid = p.get("id")
        if pid is not None:
            project_map[pid] = p

    # 1. Deleted operations
    for t in deleted_txns:
        if t.get("is_deleted") or t.get("deleted_at"):
            result.deleted_ops.append({
                "date":       fmt_date(t.get("date")),
                "amount":     fmt_amount(t.get("amount")),
                "description": t.get("description") or t.get("comment") or "—",
                "user":       get_user(t),
                "deleted_at": fmt_date(t.get("deleted_at")),
            })

    # 2. Closed-period edits: date < date_from AND updated_at >= date_from
    for t in active_txns:
        t_date = (t.get("date") or "")[:10]
        updated = (t.get("updated_at") or "")[:10]
        if t_date and updated and t_date < date_from and updated >= date_from:
            result.closed_period_edits.append({
                "date":        fmt_date(t.get("date")),
                "amount":      fmt_amount(t.get("amount")),
                "description": t.get("description") or t.get("comment") or "—",
                "updated_at":  updated,
                "user":        get_user(t),
            })

    # 3. Manual operations (no bank link)
    bank_source_keywords = {"bank", "import"}
    for t in active_txns:
        has_link = (
            t.get("bank_statement_id")
            or t.get("import_id")
            or t.get("statement_id")
            or t.get("import_hash")
        )
        source = str(t.get("source") or "").lower()
        source_is_bank = any(kw in source for kw in bank_source_keywords)
        if not has_link and not source_is_bank:
            result.manual_ops.append({
                "date":        fmt_date(t.get("date")),
                "amount":      fmt_amount(t.get("amount")),
                "description": t.get("description") or t.get("comment") or "—",
                "user":        get_user(t),
            })

    # 4. No-category operations
    for t in active_txns:
        cat = t.get("category_id") or t.get("article_id") or t.get("category")
        if not cat:
            result.no_category_ops.append({
                "date":        fmt_date(t.get("date")),
                "amount":      fmt_amount(t.get("amount")),
                "description": t.get("description") or t.get("comment") or "—",
                "user":        get_user(t),
            })

    # 5. Operations linked to closed projects
    for t in active_txns:
        pid = t.get("project_id") or (
            t.get("project", {}).get("id") if isinstance(t.get("project"), dict) else None
        )
        if pid and pid in project_map:
            proj = project_map[pid]
            status = str(proj.get("status") or "").lower()
            is_closed = bool(proj.get("is_closed"))
            if status in closed_statuses or is_closed:
                result.completed_project_ops.append({
                    "date":        fmt_date(t.get("date")),
                    "amount":      fmt_amount(t.get("amount")),
                    "description": t.get("description") or t.get("comment") or "—",
                    "project":     proj.get("name") or str(pid),
                    "user":        get_user(t),
                })

    # 6. Balance discrepancies
    for acc in result.accounts:
        adesk_bal  = acc.get("balance")
        bank_bal   = acc.get("bank_balance") or acc.get("real_balance")
        if bank_bal is None:
            continue
        try:
            a = float(adesk_bal or 0)
            b = float(bank_bal)
            diff = b - a
            if abs(diff) > 0.009:
                result.balance_discrepancies.append({
                    "account":       acc.get("name") or acc.get("title") or str(acc.get("id")),
                    "bank":          acc.get("bank") or acc.get("bank_name") or "—",
                    "adesk_balance": fmt_amount(a),
                    "bank_balance":  fmt_amount(b),
                    "diff":          fmt_amount(diff),
                })
        except (TypeError, ValueError):
            continue

    return result

# ---------------------------------------------------------------------------
# PDF helpers
# ---------------------------------------------------------------------------

def _make_styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    styles = {}

    styles["title_cover"] = ParagraphStyle(
        "title_cover",
        fontName=FONT_BOLD,
        fontSize=22,
        textColor=colors.white,
        leading=28,
        alignment=1,
    )
    styles["normal"] = ParagraphStyle(
        "normal_ru",
        fontName=FONT_NORMAL,
        fontSize=10,
        leading=14,
        textColor=colors.black,
    )
    styles["bold"] = ParagraphStyle(
        "bold_ru",
        fontName=FONT_BOLD,
        fontSize=10,
        leading=14,
        textColor=colors.black,
    )
    styles["heading"] = ParagraphStyle(
        "heading_ru",
        fontName=FONT_BOLD,
        fontSize=14,
        leading=18,
        textColor=ACCENT,
        spaceAfter=4,
    )
    styles["subheading"] = ParagraphStyle(
        "subheading_ru",
        fontName=FONT_BOLD,
        fontSize=11,
        leading=15,
        textColor=ACCENT,
        spaceAfter=3,
    )
    styles["desc"] = ParagraphStyle(
        "desc_ru",
        fontName=FONT_NORMAL,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#666666"),
        fontStyle="italic" if FONT_NORMAL == "Helvetica" else "normal",
    )
    styles["cell"] = ParagraphStyle(
        "cell_ru",
        fontName=FONT_NORMAL,
        fontSize=8,
        leading=11,
        textColor=colors.black,
    )
    styles["cell_bold"] = ParagraphStyle(
        "cell_bold_ru",
        fontName=FONT_BOLD,
        fontSize=8,
        leading=11,
        textColor=colors.white,
    )
    styles["stat_num"] = ParagraphStyle(
        "stat_num",
        fontName=FONT_BOLD,
        fontSize=18,
        leading=22,
        textColor=ACCENT,
        alignment=1,
    )
    styles["stat_label"] = ParagraphStyle(
        "stat_label",
        fontName=FONT_NORMAL,
        fontSize=9,
        leading=12,
        textColor=colors.HexColor("#555555"),
        alignment=1,
    )
    styles["footer"] = ParagraphStyle(
        "footer",
        fontName=FONT_NORMAL,
        fontSize=8,
        leading=10,
        textColor=colors.HexColor("#999999"),
        alignment=1,
    )
    styles["recommendation"] = ParagraphStyle(
        "recommendation",
        fontName=FONT_NORMAL,
        fontSize=10,
        leading=14,
        textColor=colors.black,
        leftIndent=10,
        spaceAfter=4,
    )
    return styles


def _table_style_violations(num_rows: int) -> TableStyle:
    cmds = [
        ("BACKGROUND",  (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR",   (0, 0), (-1, 0), colors.white),
        ("FONTNAME",    (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE",    (0, 0), (-1, -1), 8),
        ("LEADING",     (0, 0), (-1, -1), 11),
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
        ("GRID",        (0, 0), (-1, -1), 0.5, GRAY_MID),
        ("TOPPADDING",  (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, num_rows):
        bg = colors.white if i % 2 == 1 else GRAY_LIGHT
        cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
    return TableStyle(cmds)


def _wrap_cells(rows: List[List[Any]], style: ParagraphStyle) -> List[List[Any]]:
    """Wrap every string cell in a Paragraph for word-wrapping."""
    wrapped = []
    for row in rows:
        new_row = []
        for cell in row:
            if isinstance(cell, str):
                new_row.append(Paragraph(cell, style))
            else:
                new_row.append(cell)
        wrapped.append(new_row)
    return wrapped


def _violation_table(
    headers: List[str],
    rows: List[List[str]],
    col_widths: List[float],
    cell_style: ParagraphStyle,
    header_style: ParagraphStyle,
) -> Table:
    header_row = [Paragraph(h, header_style) for h in headers]
    data_rows = _wrap_cells(rows, cell_style)
    all_rows = [header_row] + data_rows
    tbl = Table(all_rows, colWidths=col_widths, repeatRows=1)
    tbl.setStyle(_table_style_violations(len(all_rows)))
    return tbl

# ---------------------------------------------------------------------------
# generate_pdf()
# ---------------------------------------------------------------------------

def generate_pdf(
    result: AuditResult,
    client_name: str,
    date_from: str,
    date_to: str,
    auditor: str,
    output_path: str,
) -> None:
    register_fonts()
    styles = _make_styles()
    today_str = datetime.now().strftime("%d.%m.%Y")

    page_w, page_h = A4
    margin = 20 * mm
    content_w = page_w - 2 * margin

    # --- Footer callback ---
    def add_footer(canvas, doc):
        canvas.saveState()
        footer_text = (
            f"Аудит подготовлен: {auditor}  |  {today_str}  |  "
            f"Конфиденциально  |  Стр. {doc.page}"
        )
        canvas.setFont(FONT_NORMAL, 8)
        canvas.setFillColor(colors.HexColor("#999999"))
        canvas.drawCentredString(page_w / 2, 10 * mm, footer_text)
        canvas.restoreState()

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=margin,
        bottomMargin=20 * mm,
    )

    story = []

    # -----------------------------------------------------------------------
    # Section 1: Cover page
    # -----------------------------------------------------------------------

    story.append(Spacer(1, 20 * mm))

    cover_data = [[
        Paragraph(
            "АУДИТ ФИНАНСОВОГО УЧЁТА\nAdesk",
            styles["title_cover"],
        )
    ]]
    cover_tbl = Table(cover_data, colWidths=[content_w])
    cover_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), ACCENT),
        ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING",    (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
        ("LEFTPADDING",   (0, 0), (-1, -1), 10),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 10),
    ]))
    story.append(cover_tbl)
    story.append(Spacer(1, 14 * mm))

    story.append(Paragraph(f"Клиент: {client_name}", styles["bold"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Период: {date_from} — {date_to}", styles["normal"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Дата формирования: {today_str}", styles["normal"]))
    story.append(Spacer(1, 4))
    story.append(Paragraph(f"Аудитор: {auditor}", styles["normal"]))

    story.append(PageBreak())

    # -----------------------------------------------------------------------
    # Section 2: Summary
    # -----------------------------------------------------------------------

    story.append(Paragraph("Сводка аудита", styles["heading"]))
    story.append(HRFlowable(width=content_w, thickness=1, color=ACCENT, spaceAfter=8))
    story.append(Spacer(1, 4))

    stats = [
        (str(len(result.deleted_ops)),           "Удалено\nопераций"),
        (str(len(result.balance_discrepancies)), "Расхождений\nостатков"),
        (str(len(result.manual_ops)),             "Создано\nвручную"),
        (str(len(result.accounts)),               "Счетов\nпроверено"),
    ]

    col_w = content_w / 4
    stat_data = [[
        [
            Paragraph(val, styles["stat_num"]),
            Paragraph(lbl, styles["stat_label"]),
        ]
        for val, lbl in stats
    ]]

    # Build a table where each cell is itself a mini-table
    def _stat_cell(val: str, lbl: str) -> Table:
        inner = Table(
            [[Paragraph(val, styles["stat_num"])],
             [Paragraph(lbl, styles["stat_label"])]],
            colWidths=[col_w - 8],
        )
        inner.setStyle(TableStyle([
            ("ALIGN",         (0, 0), (-1, -1), "CENTER"),
            ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
            ("TOPPADDING",    (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ]))
        return inner

    stat_cells = [[_stat_cell(v, l) for v, l in stats]]
    stat_tbl = Table(stat_cells, colWidths=[col_w] * 4)
    stat_tbl.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, -1), colors.white),
        ("BOX",           (0, 0), (-1, -1), 1, GRAY_MID),
        ("INNERGRID",     (0, 0), (-1, -1), 1, GRAY_MID),
        ("TOPPADDING",    (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING",   (0, 0), (-1, -1), 4),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 4),
        ("VALIGN",        (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(stat_tbl)
    story.append(Spacer(1, 10 * mm))

    # -----------------------------------------------------------------------
    # Section 3: Account status table
    # -----------------------------------------------------------------------

    story.append(Paragraph("Статус по счетам", styles["heading"]))
    story.append(HRFlowable(width=content_w, thickness=1, color=ACCENT, spaceAfter=8))
    story.append(Spacer(1, 4))

    disc_account_names = {d["account"] for d in result.balance_discrepancies}

    acc_headers = ["Счёт", "Банк", "Валюта", "Остаток", "Статус", "Проблемы"]
    acc_col_w = [
        content_w * 0.22,
        content_w * 0.18,
        content_w * 0.09,
        content_w * 0.15,
        content_w * 0.15,
        content_w * 0.21,
    ]

    cell_s = styles["cell"]
    cell_b = styles["cell_bold"]
    green_style = ParagraphStyle(
        "green_cell",
        fontName=FONT_NORMAL,
        fontSize=8,
        leading=11,
        textColor=colors.HexColor("#1a7a1a"),
    )
    red_style = ParagraphStyle(
        "red_cell",
        fontName=FONT_NORMAL,
        fontSize=8,
        leading=11,
        textColor=ACCENT,
    )

    acc_rows = [
        [Paragraph(h, cell_b) for h in acc_headers]
    ]
    for i, acc in enumerate(result.accounts):
        acc_name  = acc.get("name") or acc.get("title") or str(acc.get("id", "—"))
        bank_name = acc.get("bank") or acc.get("bank_name") or "—"
        currency  = acc.get("currency") or acc.get("currency_code") or "RUB"
        balance   = fmt_amount(acc.get("balance"))
        has_disc  = acc_name in disc_account_names

        if has_disc:
            status_p   = Paragraph("✗ Расхождение", red_style)
            problems_p = Paragraph("Расхождение остатков", red_style)
        else:
            status_p   = Paragraph("✓ OK", green_style)
            problems_p = Paragraph("—", cell_s)

        row_bg = colors.white if i % 2 == 0 else GRAY_LIGHT
        acc_rows.append([
            Paragraph(acc_name, cell_s),
            Paragraph(bank_name, cell_s),
            Paragraph(str(currency), cell_s),
            Paragraph(str(balance), cell_s),
            status_p,
            problems_p,
        ])

    acc_tbl = Table(acc_rows, colWidths=acc_col_w, repeatRows=1)
    acc_cmds = [
        ("BACKGROUND",    (0, 0), (-1, 0), ACCENT),
        ("TEXTCOLOR",     (0, 0), (-1, 0), colors.white),
        ("FONTNAME",      (0, 0), (-1, 0), FONT_BOLD),
        ("FONTSIZE",      (0, 0), (-1, -1), 8),
        ("LEADING",       (0, 0), (-1, -1), 11),
        ("VALIGN",        (0, 0), (-1, -1), "TOP"),
        ("GRID",          (0, 0), (-1, -1), 0.5, GRAY_MID),
        ("TOPPADDING",    (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING",   (0, 0), (-1, -1), 5),
        ("RIGHTPADDING",  (0, 0), (-1, -1), 5),
    ]
    for i in range(1, len(acc_rows)):
        bg = colors.white if i % 2 == 1 else GRAY_LIGHT
        acc_cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
    acc_tbl.setStyle(TableStyle(acc_cmds))
    story.append(acc_tbl)
    story.append(Spacer(1, 10 * mm))

    # -----------------------------------------------------------------------
    # Section 4: Violations
    # -----------------------------------------------------------------------

    # --- 4.1 Deleted operations ---
    if result.deleted_ops:
        story.append(Paragraph(
            f"Удалённые операции ({len(result.deleted_ops)})",
            styles["subheading"],
        ))
        story.append(Paragraph(
            "Операции, удалённые из системы в анализируемом периоде.",
            styles["desc"],
        ))
        story.append(Spacer(1, 3))
        cw = [
            content_w * 0.11,
            content_w * 0.14,
            content_w * 0.33,
            content_w * 0.22,
            content_w * 0.20,
        ]
        rows = [
            [
                d["date"], d["amount"], d["description"],
                d["user"], d["deleted_at"],
            ]
            for d in result.deleted_ops
        ]
        story.append(_violation_table(
            ["Дата", "Сумма", "Назначение", "Пользователь", "Дата удаления"],
            rows, cw, styles["cell"], styles["cell_bold"],
        ))
        story.append(Spacer(1, 8 * mm))

    # --- 4.2 Closed-period edits ---
    if result.closed_period_edits:
        story.append(Paragraph(
            f"Правки закрытых периодов ({len(result.closed_period_edits)})",
            styles["subheading"],
        ))
        story.append(Paragraph(
            "Операции прошлых периодов, изменённые в текущем периоде.",
            styles["desc"],
        ))
        story.append(Spacer(1, 3))
        cw = [
            content_w * 0.11,
            content_w * 0.14,
            content_w * 0.33,
            content_w * 0.20,
            content_w * 0.22,
        ]
        rows = [
            [
                d["date"], d["amount"], d["description"],
                d["updated_at"], d["user"],
            ]
            for d in result.closed_period_edits
        ]
        story.append(_violation_table(
            ["Дата операции", "Сумма", "Назначение", "Дата изменения", "Пользователь"],
            rows, cw, styles["cell"], styles["cell_bold"],
        ))
        story.append(Spacer(1, 8 * mm))

    # --- 4.3 Manual operations ---
    if result.manual_ops:
        story.append(Paragraph(
            f"Ручной ввод ({len(result.manual_ops)})",
            styles["subheading"],
        ))
        story.append(Paragraph(
            "Операции без привязки к банковской выписке — введены вручную.",
            styles["desc"],
        ))
        story.append(Spacer(1, 3))
        cw = [
            content_w * 0.12,
            content_w * 0.15,
            content_w * 0.46,
            content_w * 0.27,
        ]
        rows = [
            [d["date"], d["amount"], d["description"], d["user"]]
            for d in result.manual_ops
        ]
        story.append(_violation_table(
            ["Дата", "Сумма", "Назначение", "Пользователь"],
            rows, cw, styles["cell"], styles["cell_bold"],
        ))
        story.append(Spacer(1, 8 * mm))

    # --- 4.4 No-category operations ---
    if result.no_category_ops:
        story.append(Paragraph(
            f"Операции без статьи ({len(result.no_category_ops)})",
            styles["subheading"],
        ))
        story.append(Paragraph(
            "Операции без статьи — не учитываются в ДДС и ОПиУ.",
            styles["desc"],
        ))
        story.append(Spacer(1, 3))
        cw = [
            content_w * 0.12,
            content_w * 0.15,
            content_w * 0.46,
            content_w * 0.27,
        ]
        rows = [
            [d["date"], d["amount"], d["description"], d["user"]]
            for d in result.no_category_ops
        ]
        story.append(_violation_table(
            ["Дата", "Сумма", "Назначение", "Пользователь"],
            rows, cw, styles["cell"], styles["cell_bold"],
        ))
        story.append(Spacer(1, 8 * mm))

    # --- 4.5 Completed-project operations ---
    if result.completed_project_ops:
        story.append(Paragraph(
            f"Операции в завершённых проектах ({len(result.completed_project_ops)})",
            styles["subheading"],
        ))
        story.append(Paragraph(
            "Операции, привязанные к завершённым проектам.",
            styles["desc"],
        ))
        story.append(Spacer(1, 3))
        cw = [
            content_w * 0.11,
            content_w * 0.13,
            content_w * 0.30,
            content_w * 0.24,
            content_w * 0.22,
        ]
        rows = [
            [
                d["date"], d["amount"], d["description"],
                d["project"], d["user"],
            ]
            for d in result.completed_project_ops
        ]
        story.append(_violation_table(
            ["Дата", "Сумма", "Назначение", "Проект", "Пользователь"],
            rows, cw, styles["cell"], styles["cell_bold"],
        ))
        story.append(Spacer(1, 8 * mm))

    # --- 4.6 Balance discrepancies ---
    if result.balance_discrepancies:
        story.append(Paragraph(
            f"Расхождения остатков ({len(result.balance_discrepancies)})",
            styles["subheading"],
        ))
        story.append(Paragraph(
            "Расхождение между остатком в Adesk и фактическим остатком в банке.",
            styles["desc"],
        ))
        story.append(Spacer(1, 3))
        cw = [
            content_w * 0.24,
            content_w * 0.18,
            content_w * 0.19,
            content_w * 0.19,
            content_w * 0.20,
        ]
        rows = [
            [
                d["account"], d["bank"],
                d["adesk_balance"], d["bank_balance"], d["diff"],
            ]
            for d in result.balance_discrepancies
        ]
        story.append(_violation_table(
            ["Счёт", "Банк", "Остаток Adesk", "Остаток банк", "Разница"],
            rows, cw, styles["cell"], styles["cell_bold"],
        ))
        story.append(Spacer(1, 8 * mm))

    # -----------------------------------------------------------------------
    # Section 5: Recommendations
    # -----------------------------------------------------------------------

    story.append(Paragraph("Рекомендации", styles["heading"]))
    story.append(HRFlowable(width=content_w, thickness=1, color=ACCENT, spaceAfter=8))
    story.append(Spacer(1, 4))

    recs = []

    if result.deleted_ops:
        n = len(result.deleted_ops)
        recs.append(
            f"Запросить обоснование удаления {n} операций. "
            "Восстановить некорректно удалённые."
        )
    if result.closed_period_edits:
        n = len(result.closed_period_edits)
        recs.append(
            f"Проверить {n} операций, изменённых в закрытых периодах. "
            "Ввести ограничение на правки прошлых периодов."
        )
    if result.manual_ops:
        n = len(result.manual_ops)
        recs.append(
            f"Высокая доля ручного ввода ({n} операций). "
            "Подключить автоматическую загрузку банковских выписок."
        )
    if result.no_category_ops:
        n = len(result.no_category_ops)
        recs.append(
            f"Категоризировать {n} операций без статьи — "
            "они не учитываются в ДДС и ОПиУ."
        )
    if result.completed_project_ops:
        n = len(result.completed_project_ops)
        recs.append(
            f"Исправить привязку {n} операций к завершённым проектам."
        )
    if result.balance_discrepancies:
        n = len(result.balance_discrepancies)
        recs.append(
            f"Выяснить причину расхождения остатков по {n} счетам."
        )

    if not recs:
        story.append(Paragraph(
            "Нарушений не выявлено. Учёт ведётся корректно.",
            styles["normal"],
        ))
    else:
        for idx, rec in enumerate(recs, 1):
            story.append(Paragraph(
                f"{idx}. {rec}",
                styles["recommendation"],
            ))

    # -----------------------------------------------------------------------
    # Build PDF
    # -----------------------------------------------------------------------

    doc.build(story, onFirstPage=add_footer, onLaterPages=add_footer)

# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------

def main():
    global API_KEY, CLIENT_NAME

    if not API_KEY:
        API_KEY = input("Введите API-ключ Adesk: ").strip()
    if not CLIENT_NAME:
        CLIENT_NAME = input("Название клиента: ").strip()

    print(f"Подключение к Adesk API…")
    client = AdeskClient(API_KEY)

    print(f"Анализ периода {DATE_FROM} — {DATE_TO}…")
    result = analyze(client, DATE_FROM, DATE_TO)

    print(f"\nИтоги:")
    print(f"  Всего транзакций:             {result.total_transactions}")
    print(f"  Счетов:                       {len(result.accounts)}")
    print(f"  Удалённых операций:           {len(result.deleted_ops)}")
    print(f"  Правок закрытых периодов:     {len(result.closed_period_edits)}")
    print(f"  Ручных операций:              {len(result.manual_ops)}")
    print(f"  Без категории:                {len(result.no_category_ops)}")
    print(f"  В завершённых проектах:       {len(result.completed_project_ops)}")
    print(f"  Расхождений остатков:         {len(result.balance_discrepancies)}")

    safe_client = "".join(
        c if c.isalnum() or c in ("-", "_") else "_"
        for c in CLIENT_NAME
    ).strip("_") or "client"

    output_path = os.path.join(
        OUTPUT_DIR,
        f"Аудит_Adesk_{safe_client}_{DATE_FROM}.pdf",
    )

    print(f"\nФормирование отчёта…")
    generate_pdf(result, CLIENT_NAME, DATE_FROM, DATE_TO, AUDITOR_NAME, output_path)
    print(f"Готово: {output_path}")


if __name__ == "__main__":
    main()
