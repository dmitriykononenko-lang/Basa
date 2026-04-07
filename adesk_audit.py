#!/usr/bin/env python3
"""
Adesk Financial Audit Tool
Fetches data from Adesk API and generates a PDF audit report.
"""

import os
import sys
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

import requests
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether,
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# ---------------------------------------------------------------------------
# Configuration (overridable via environment variables)
# ---------------------------------------------------------------------------

API_KEY      = os.environ.get("ADESK_API_KEY", "")
CLIENT_NAME  = os.environ.get("ADESK_CLIENT", "")
AUDITOR_NAME = os.environ.get("ADESK_AUDITOR", "Дмитрий Кононенко")
DATE_FROM    = os.environ.get("ADESK_DATE_FROM", "2026-03-01")
DATE_TO      = os.environ.get("ADESK_DATE_TO", "2026-04-06")
OUTPUT_DIR   = os.environ.get("ADESK_OUTPUT_DIR", ".")

# ---------------------------------------------------------------------------
# Colors
# ---------------------------------------------------------------------------

ACCENT       = HexColor("#E60000")
ACCENT_LIGHT = HexColor("#FFF5F5")
GRAY_LIGHT   = HexColor("#F7F7F7")
GRAY_MID     = HexColor("#DDDDDD")
COLOR_GREEN  = HexColor("#1A7A1A")
COLOR_ORANGE = HexColor("#E68000")

# ---------------------------------------------------------------------------
# Font setup
# ---------------------------------------------------------------------------

FONT_NORMAL = "DejaVu"
FONT_BOLD   = "DejaVuBold"

def register_fonts():
    """Register DejaVu fonts for Cyrillic support; fall back to Helvetica."""
    global FONT_NORMAL, FONT_BOLD
    try:
        pdfmetrics.registerFont(TTFont("DejaVu",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"))
        pdfmetrics.registerFont(TTFont("DejaVuBold",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"))
        FONT_NORMAL = "DejaVu"
        FONT_BOLD   = "DejaVuBold"
    except Exception:
        print("[Предупреждение] Шрифт DejaVu не найден. Кириллица может не отображаться.")
        FONT_NORMAL = "Helvetica"
        FONT_BOLD   = "Helvetica-Bold"

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

def fmt_amount(v) -> str:
    """Format a numeric value as '1 234.56 ₽'."""
    try:
        n = float(v)
        # Format with 2 decimal places, then replace comma with space for thousands
        formatted = f"{n:,.2f}".replace(",", "\u2009")  # thin space
        # Fallback: manual approach for plain space separator
        integer_part = int(abs(n))
        frac = abs(n) - integer_part
        sign = "-" if n < 0 else ""
        int_str = f"{integer_part:,}".replace(",", " ")
        return f"{sign}{int_str}.{round(frac * 100):02d} ₽"
    except (TypeError, ValueError):
        return "— ₽"


def fmt_date(v) -> str:
    """Return the first 10 characters of a date string, or '—'."""
    if v and isinstance(v, str) and len(v) >= 10:
        return v[:10]
    return "—"


def get_user(t: dict) -> str:
    """Extract the user name from a transaction dict."""
    try:
        user = t.get("user")
        if isinstance(user, dict):
            return user.get("name") or str(user.get("id", "—"))
    except Exception:
        pass
    for key in ("user_name", ):
        val = t.get(key)
        if val:
            return str(val)
    try:
        author = t.get("author")
        if isinstance(author, dict):
            return author.get("name") or str(author.get("id", "—"))
    except Exception:
        pass
    uid = t.get("user_id")
    if uid:
        return str(uid)
    return "—"


# ---------------------------------------------------------------------------
# Adesk API client
# ---------------------------------------------------------------------------

class AdeskClient:
    BASE_URL = "https://api.adesk.ru/v1"

    def __init__(self, api_key: str):
        self.api_key = api_key
        self.session = requests.Session()
        self.session.timeout = 30

    def _unwrap(self, data: Any, hint: str) -> list:
        """Smart unwrap: find the list payload inside the Adesk response."""
        if isinstance(data, list):
            return data
        if isinstance(data, dict):
            # Try hint-based key first (e.g. "bankaccounts", "transactions")
            if hint in data:
                val = data[hint]
                if isinstance(val, list):
                    return val
            # Generic fallbacks
            for key in ("data", "items"):
                if key in data and isinstance(data[key], list):
                    return data[key]
            # Any list value
            for val in data.values():
                if isinstance(val, list):
                    return val
        return []

    def _get_paginated(self, path: str, params: dict = None, hint: str = "") -> list:
        """Fetch all pages from a paginated endpoint."""
        params = params or {}
        params["api_token"] = self.api_key
        params["limit"] = 500
        results = []
        offset = 0
        while True:
            params["offset"] = offset
            url = f"{self.BASE_URL}/{path.lstrip('/')}"
            try:
                resp = self.session.get(url, params=params)
                resp.raise_for_status()
            except requests.HTTPError as exc:
                raise RuntimeError(
                    f"HTTP {exc.response.status_code} при запросе {url}: {exc.response.text[:200]}"
                ) from exc
            except requests.RequestException as exc:
                raise RuntimeError(f"Ошибка сети при запросе {url}: {exc}") from exc

            try:
                payload = resp.json()
            except Exception:
                raise RuntimeError(f"Неверный JSON от {url}")

            chunk = self._unwrap(payload, hint)
            results.extend(chunk)
            if len(chunk) < 500:
                break
            offset += 500
        return results

    def get_bank_accounts(self) -> list:
        print("  Загрузка банковских счетов…")
        return self._get_paginated("bankaccounts", hint="bankaccounts")

    def get_transactions(self, date_from: str, date_to: str,
                         include_deleted: bool = False) -> list:
        params = {"date_from": date_from, "date_to": date_to}
        if include_deleted:
            params["is_deleted"] = 1
        label = "удалённых " if include_deleted else ""
        print(f"  Загрузка {label}транзакций…")
        return self._get_paginated("transactions", params=params, hint="transactions")

    def get_categories(self) -> list:
        print("  Загрузка категорий…")
        return self._get_paginated("transactions/categories", hint="categories")

    def get_projects(self) -> list:
        print("  Загрузка проектов…")
        return self._get_paginated("projects", hint="projects")


# ---------------------------------------------------------------------------
# Audit analysis
# ---------------------------------------------------------------------------

@dataclass
class AuditResult:
    deleted_ops:             list = field(default_factory=list)
    closed_period_edits:     list = field(default_factory=list)
    manual_ops:              list = field(default_factory=list)
    no_category_ops:         list = field(default_factory=list)
    completed_project_ops:   list = field(default_factory=list)
    balance_discrepancies:   list = field(default_factory=list)
    total_transactions:      int  = 0
    accounts:                list = field(default_factory=list)


def _is_closed_project(project: dict) -> bool:
    status = str(project.get("status", "")).lower()
    if status in ("closed", "finished", "completed"):
        return True
    if project.get("is_closed"):
        return True
    return False


def analyze(client: AdeskClient, date_from: str, date_to: str) -> AuditResult:
    result = AuditResult()

    # Fetch data
    accounts     = client.get_bank_accounts()
    transactions = client.get_transactions(date_from, date_to, include_deleted=False)
    deleted_txns = client.get_transactions(date_from, date_to, include_deleted=True)
    projects     = client.get_projects()

    result.accounts           = accounts
    result.total_transactions = len(transactions)

    # Build project lookup
    project_map: dict[Any, dict] = {}
    for p in projects:
        pid = p.get("id")
        if pid is not None:
            project_map[pid] = p

    # 1. Deleted operations
    for t in deleted_txns:
        if not t.get("deleted_at") and not t.get("is_deleted"):
            continue
        result.deleted_ops.append({
            "date":       fmt_date(t.get("date")),
            "amount":     fmt_amount(t.get("amount", 0)),
            "description": t.get("description") or t.get("comment") or "—",
            "user":       get_user(t),
            "deleted_at": fmt_date(t.get("deleted_at")),
        })

    # 2. Closed-period edits: date < DATE_FROM but updated_at >= DATE_FROM
    for t in transactions:
        t_date     = (t.get("date") or "")[:10]
        updated_at = (t.get("updated_at") or "")[:10]
        if t_date and updated_at and t_date < date_from and updated_at >= date_from:
            result.closed_period_edits.append({
                "date":       fmt_date(t.get("date")),
                "amount":     fmt_amount(t.get("amount", 0)),
                "description": t.get("description") or t.get("comment") or "—",
                "updated_at": fmt_date(t.get("updated_at")),
                "user":       get_user(t),
            })

    # 3. Manual operations (no bank statement link)
    bank_keys = ("bank_statement_id", "import_id", "statement_id", "import_hash")
    for t in transactions:
        has_bank_link = any(t.get(k) for k in bank_keys)
        source = str(t.get("source", "")).lower()
        if source in ("bank", "import"):
            has_bank_link = True
        if not has_bank_link:
            result.manual_ops.append({
                "date":       fmt_date(t.get("date")),
                "amount":     fmt_amount(t.get("amount", 0)),
                "description": t.get("description") or t.get("comment") or "—",
                "user":       get_user(t),
            })

    # 4. No category
    for t in transactions:
        cat_id = t.get("category_id") or t.get("article_id") or t.get("category")
        if not cat_id:
            result.no_category_ops.append({
                "date":       fmt_date(t.get("date")),
                "amount":     fmt_amount(t.get("amount", 0)),
                "description": t.get("description") or t.get("comment") or "—",
                "user":       get_user(t),
            })

    # 5. Completed project operations
    for t in transactions:
        pid = t.get("project_id") or t.get("project")
        if not pid:
            continue
        proj = project_map.get(pid)
        if proj and _is_closed_project(proj):
            proj_name = proj.get("name") or str(pid)
            result.completed_project_ops.append({
                "date":        fmt_date(t.get("date")),
                "amount":      fmt_amount(t.get("amount", 0)),
                "description": t.get("description") or t.get("comment") or "—",
                "project":     proj_name,
                "user":        get_user(t),
            })

    # 6. Balance discrepancies
    for acc in accounts:
        adesk_balance = acc.get("balance")
        bank_balance  = acc.get("bank_balance") or acc.get("real_balance")
        if adesk_balance is None or bank_balance is None:
            continue
        try:
            diff = float(adesk_balance) - float(bank_balance)
        except (TypeError, ValueError):
            continue
        if abs(diff) > 0.005:
            result.balance_discrepancies.append({
                "account":       acc.get("name") or acc.get("title") or str(acc.get("id", "—")),
                "bank":          acc.get("bank") or "—",
                "adesk_balance": fmt_amount(adesk_balance),
                "bank_balance":  fmt_amount(bank_balance),
                "diff":          fmt_amount(diff),
            })

    return result


# ---------------------------------------------------------------------------
# PDF generation
# ---------------------------------------------------------------------------

def build_styles():
    base = getSampleStyleSheet()
    styles = {}
    styles["title"] = ParagraphStyle(
        "AuditTitle", fontName=FONT_BOLD, fontSize=22,
        textColor=colors.white, spaceAfter=4,
    )
    styles["subtitle"] = ParagraphStyle(
        "AuditSubtitle", fontName=FONT_NORMAL, fontSize=13,
        textColor=colors.white, spaceAfter=2,
    )
    styles["cover_field"] = ParagraphStyle(
        "CoverField", fontName=FONT_NORMAL, fontSize=11,
        textColor=colors.black, spaceAfter=6,
    )
    styles["heading"] = ParagraphStyle(
        "AuditH1", fontName=FONT_BOLD, fontSize=14,
        textColor=colors.black, spaceBefore=12, spaceAfter=6,
    )
    styles["section_heading"] = ParagraphStyle(
        "AuditH2", fontName=FONT_BOLD, fontSize=11,
        textColor=ACCENT, spaceBefore=10, spaceAfter=4,
    )
    styles["normal"] = ParagraphStyle(
        "AuditNormal", fontName=FONT_NORMAL, fontSize=9,
        textColor=colors.black, spaceAfter=4,
    )
    styles["small_gray"] = ParagraphStyle(
        "AuditSmallGray", fontName=FONT_NORMAL, fontSize=8,
        textColor=colors.gray, spaceAfter=2,
    )
    styles["cell"] = ParagraphStyle(
        "AuditCell", fontName=FONT_NORMAL, fontSize=8,
        textColor=colors.black, leading=10,
    )
    styles["cell_bold"] = ParagraphStyle(
        "AuditCellBold", fontName=FONT_BOLD, fontSize=8,
        textColor=colors.white, leading=10,
    )
    styles["recommendation"] = ParagraphStyle(
        "AuditRec", fontName=FONT_NORMAL, fontSize=9,
        textColor=colors.black, spaceAfter=5, leftIndent=12,
    )
    return styles


def _table_style(n_rows: int) -> TableStyle:
    """Standard audit table style with alternating rows."""
    cmds = [
        ("BACKGROUND",  (0, 0), (-1, 0),  ACCENT),
        ("TEXTCOLOR",   (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",    (0, 0), (-1, 0),  FONT_BOLD),
        ("FONTSIZE",    (0, 0), (-1, -1), 8),
        ("FONTNAME",    (0, 1), (-1, -1), FONT_NORMAL),
        ("GRID",        (0, 0), (-1, -1), 0.5, GRAY_MID),
        ("ROWBACKGROUND", (0, 0), (-1, 0), ACCENT),
        ("VALIGN",      (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING",  (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 5),
    ]
    for i in range(1, n_rows):
        bg = GRAY_LIGHT if i % 2 == 0 else colors.white
        cmds.append(("BACKGROUND", (0, i), (-1, i), bg))
    return TableStyle(cmds)


def _p(text, style) -> Paragraph:
    return Paragraph(str(text), style)


def build_section_violations(result: AuditResult, styles: dict) -> list:
    """Build violation flowables for all non-empty checks."""
    story = []
    S = styles

    descriptions = {
        "deleted":    "Операции, удалённые в отчётном периоде. Требуют обоснования.",
        "closed":     "Операции в закрытых периодах, изменённые в текущем периоде.",
        "manual":     "Операции, введённые вручную без привязки к банковской выписке.",
        "no_cat":     "Операции без категории/статьи — не попадают в отчёты ДДС и ОПиУ.",
        "proj":       "Операции, привязанные к завершённым/закрытым проектам.",
        "balance":    "Счета, где остаток Adesk не совпадает с фактическим остатком в банке.",
    }

    def make_table(headers, rows):
        header_row = [_p(h, S["cell_bold"]) for h in headers]
        data = [header_row] + [
            [_p(str(cell), S["cell"]) for cell in row]
            for row in rows
        ]
        col_count = len(headers)
        page_w = A4[0] - 40 * mm
        col_w = page_w / col_count
        t = Table(data, colWidths=[col_w] * col_count, repeatRows=1)
        t.setStyle(_table_style(len(data)))
        return t

    # 1. Deleted operations
    if result.deleted_ops:
        n = len(result.deleted_ops)
        story.append(_p(f"🔴 Удалённые операции ({n})", S["section_heading"]))
        story.append(_p(descriptions["deleted"], S["normal"]))
        rows = [
            [r["date"], r["amount"], r["description"], r["user"], r["deleted_at"]]
            for r in result.deleted_ops
        ]
        story.append(make_table(
            ["Дата", "Сумма", "Назначение", "Пользователь", "Дата удаления"], rows
        ))
        story.append(Spacer(1, 6))

    # 2. Closed period edits
    if result.closed_period_edits:
        n = len(result.closed_period_edits)
        story.append(_p(f"🔴 Правки в закрытых периодах ({n})", S["section_heading"]))
        story.append(_p(descriptions["closed"], S["normal"]))
        rows = [
            [r["date"], r["amount"], r["description"], r["updated_at"], r["user"]]
            for r in result.closed_period_edits
        ]
        story.append(make_table(
            ["Дата операции", "Сумма", "Назначение", "Дата изменения", "Пользователь"], rows
        ))
        story.append(Spacer(1, 6))

    # 3. Manual operations
    if result.manual_ops:
        n = len(result.manual_ops)
        story.append(_p(f"🔴 Созданы вручную ({n})", S["section_heading"]))
        story.append(_p(descriptions["manual"], S["normal"]))
        rows = [
            [r["date"], r["amount"], r["description"], r["user"]]
            for r in result.manual_ops
        ]
        story.append(make_table(
            ["Дата", "Сумма", "Назначение", "Пользователь"], rows
        ))
        story.append(Spacer(1, 6))

    # 4. No category
    if result.no_category_ops:
        n = len(result.no_category_ops)
        story.append(_p(f"🔴 Без категории ({n})", S["section_heading"]))
        story.append(_p(descriptions["no_cat"], S["normal"]))
        rows = [
            [r["date"], r["amount"], r["description"], r["user"]]
            for r in result.no_category_ops
        ]
        story.append(make_table(
            ["Дата", "Сумма", "Назначение", "Пользователь"], rows
        ))
        story.append(Spacer(1, 6))

    # 5. Completed project ops
    if result.completed_project_ops:
        n = len(result.completed_project_ops)
        story.append(_p(f"🔴 Записи на завершённые проекты ({n})", S["section_heading"]))
        story.append(_p(descriptions["proj"], S["normal"]))
        rows = [
            [r["date"], r["amount"], r["description"], r["project"], r["user"]]
            for r in result.completed_project_ops
        ]
        story.append(make_table(
            ["Дата", "Сумма", "Назначение", "Проект", "Пользователь"], rows
        ))
        story.append(Spacer(1, 6))

    # 6. Balance discrepancies
    if result.balance_discrepancies:
        n = len(result.balance_discrepancies)
        story.append(_p(f"🔴 Расхождение остатков ({n})", S["section_heading"]))
        story.append(_p(descriptions["balance"], S["normal"]))
        rows = [
            [r["account"], r["bank"], r["adesk_balance"], r["bank_balance"], r["diff"]]
            for r in result.balance_discrepancies
        ]
        story.append(make_table(
            ["Счёт", "Банк", "Остаток Adesk", "Остаток банк", "Разница"], rows
        ))
        story.append(Spacer(1, 6))

    return story


def build_recommendations(result: AuditResult, styles: dict) -> list:
    story = []
    S = styles
    story.append(_p("Рекомендации", S["heading"]))

    recs = []
    n_del   = len(result.deleted_ops)
    n_close = len(result.closed_period_edits)
    n_man   = len(result.manual_ops)
    n_cat   = len(result.no_category_ops)
    n_proj  = len(result.completed_project_ops)
    n_bal   = len(result.balance_discrepancies)
    total   = result.total_transactions or 1

    if n_del:
        recs.append(
            f"Запросить у сотрудников обоснование удаления {n_del} операций. "
            "Восстановить некорректно удалённые."
        )
    if n_close:
        recs.append(
            f"Проверить {n_close} операций, изменённых в закрытых периодах. "
            "Ввести ограничение на правки прошлых периодов в настройках Adesk."
        )
    if n_man > total * 0.10:
        recs.append(
            f"Высокая доля ручного ввода ({n_man} операций). "
            "Подключить автоматическую загрузку банковских выписок."
        )
    if n_cat:
        recs.append(
            f"Категоризировать {n_cat} операций без статьи — "
            "они не учитываются в ДДС и ОПиУ."
        )
    if n_proj:
        recs.append(
            f"Исправить привязку {n_proj} операций к завершённым проектам."
        )
    if n_bal:
        recs.append(
            f"Выяснить причину расхождения остатков по {n_bal} счетам."
        )

    if not recs:
        recs.append("Нарушений не выявлено. Учёт ведётся корректно.")

    for i, rec in enumerate(recs, 1):
        story.append(_p(f"{i}. {rec}", S["recommendation"]))

    return story


def generate_pdf(result: AuditResult, client_name: str,
                 date_from: str, date_to: str,
                 auditor: str, output_path: str) -> None:
    register_fonts()
    S = build_styles()
    today_str = datetime.today().strftime("%d.%m.%Y")

    doc = SimpleDocTemplate(
        output_path,
        pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm,
        topMargin=20 * mm,  bottomMargin=20 * mm,
    )

    def footer_cb(canvas, doc):
        canvas.saveState()
        canvas.setFont(FONT_NORMAL, 8)
        canvas.setFillColor(colors.gray)
        text = (
            f"Аудит подготовлен: {auditor}  |  {today_str}  |  "
            f"Конфиденциально  |  Стр. {doc.page}"
        )
        canvas.drawCentredString(A4[0] / 2, 12 * mm, text)
        canvas.restoreState()

    story = []

    # ------------------------------------------------------------------
    # Section 1: Cover page
    # ------------------------------------------------------------------
    # Red header block simulated with a 1-row table
    cover_header_data = [[
        Paragraph(
            "<br/>".join([
                f'<font name="{FONT_BOLD}" size="22" color="white">АУДИТ ФИНАНСОВОГО УЧЁТА</font>',
                f'<font name="{FONT_NORMAL}" size="13" color="white">Adesk</font>',
            ]),
            ParagraphStyle("ch", fontName=FONT_BOLD, fontSize=22,
                           textColor=colors.white, leading=30),
        )
    ]]
    cover_w = A4[0] - 40 * mm
    cover_header = Table(cover_header_data, colWidths=[cover_w])
    cover_header.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), ACCENT),
        ("TOPPADDING",    (0, 0), (-1, -1), 18),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 18),
        ("LEFTPADDING",   (0, 0), (-1, -1), 16),
    ]))
    story.append(cover_header)
    story.append(Spacer(1, 20))

    story.append(_p(f"<b>Клиент:</b> {client_name}", S["cover_field"]))
    story.append(_p(f"<b>Период:</b> {date_from} — {date_to}", S["cover_field"]))
    story.append(_p(f"<b>Дата формирования:</b> {today_str}", S["cover_field"]))
    story.append(_p(f"<b>Аудитор:</b> {auditor}", S["cover_field"]))
    story.append(PageBreak())

    # ------------------------------------------------------------------
    # Section 2: Summary
    # ------------------------------------------------------------------
    story.append(_p("Сводка аудита", S["heading"]))

    n_accounts = len(result.accounts)
    stat_items = [
        ("Удалено операций",        len(result.deleted_ops)),
        ("Несовпадений остатков",   len(result.balance_discrepancies)),
        ("Создано вручную",         len(result.manual_ops)),
        ("Счетов проверено",        n_accounts),
    ]

    def stat_box(label: str, count: int):
        return [
            Paragraph(str(count),
                ParagraphStyle("sn", fontName=FONT_BOLD, fontSize=28,
                               textColor=ACCENT, alignment=1)),
            Paragraph(label,
                ParagraphStyle("sl", fontName=FONT_NORMAL, fontSize=8,
                               textColor=colors.gray, alignment=1)),
        ]

    box_cells = [[stat_box(lbl, cnt) for lbl, cnt in stat_items]]
    box_table = Table(box_cells, colWidths=[cover_w / 4] * 4)
    box_table.setStyle(TableStyle([
        ("BOX",         (0, 0), (-1, -1), 0.5, GRAY_MID),
        ("INNERGRID",   (0, 0), (-1, -1), 0.5, GRAY_MID),
        ("TOPPADDING",  (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("BACKGROUND",  (0, 0), (-1, -1), GRAY_LIGHT),
        ("VALIGN",      (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(box_table)
    story.append(Spacer(1, 14))

    # ------------------------------------------------------------------
    # Section 3: Account status
    # ------------------------------------------------------------------
    story.append(_p("Статус по счетам", S["heading"]))

    problem_accounts: set = set()
    for lst in (result.deleted_ops, result.closed_period_edits,
                result.manual_ops, result.no_category_ops, result.completed_project_ops):
        for item in lst:
            acct = item.get("account")
            if acct:
                problem_accounts.add(acct)

    disc_accounts = {r["account"] for r in result.balance_discrepancies}

    acc_header = [_p(h, S["cell_bold"]) for h in
                  ["Счёт", "Банк", "Валюта", "Остаток", "Статус", "Проблемы"]]
    acc_rows = [acc_header]
    for acc in result.accounts:
        name     = acc.get("name") or acc.get("title") or str(acc.get("id", "—"))
        bank     = acc.get("bank") or "—"
        currency = acc.get("currency") or "RUB"
        balance  = fmt_amount(acc.get("balance", 0))

        if name in disc_accounts:
            status_text = "✗ Расхождение"
            status_color = ACCENT
        elif name in problem_accounts:
            status_text = "⚠ Внимание"
            status_color = COLOR_ORANGE
        else:
            status_text = "✓ OK"
            status_color = COLOR_GREEN

        problems = []
        if name in disc_accounts:
            problems.append("расхождение остатка")

        status_para = Paragraph(status_text,
            ParagraphStyle("st", fontName=FONT_BOLD, fontSize=8,
                           textColor=status_color))
        acc_rows.append([
            _p(name,    S["cell"]),
            _p(bank,    S["cell"]),
            _p(currency, S["cell"]),
            _p(balance, S["cell"]),
            status_para,
            _p(", ".join(problems) or "—", S["cell"]),
        ])

    col_ws = [cover_w * f for f in (0.22, 0.18, 0.10, 0.16, 0.16, 0.18)]
    acc_table = Table(acc_rows, colWidths=col_ws, repeatRows=1)
    acc_table.setStyle(_table_style(len(acc_rows)))
    story.append(acc_table)
    story.append(Spacer(1, 14))

    # ------------------------------------------------------------------
    # Section 4: Violations
    # ------------------------------------------------------------------
    violations = build_section_violations(result, S)
    if violations:
        story.append(_p("Нарушения", S["heading"]))
        story.extend(violations)

    # ------------------------------------------------------------------
    # Section 5: Recommendations
    # ------------------------------------------------------------------
    story.append(Spacer(1, 10))
    story.extend(build_recommendations(result, S))

    # Build PDF
    doc.build(story, onFirstPage=footer_cb, onLaterPages=footer_cb)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    global API_KEY, CLIENT_NAME

    if not API_KEY:
        try:
            API_KEY = input("Введите API-ключ Adesk: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nОтменено.")
            sys.exit(1)

    if not API_KEY:
        print("Ошибка: API-ключ не указан.")
        sys.exit(1)

    if not CLIENT_NAME:
        try:
            CLIENT_NAME = input("Название клиента: ").strip()
        except (EOFError, KeyboardInterrupt):
            print("\nОтменено.")
            sys.exit(1)

    if not CLIENT_NAME:
        CLIENT_NAME = "Неизвестный клиент"

    client = AdeskClient(API_KEY)

    print(f"\nЗапуск аудита: {CLIENT_NAME} / {DATE_FROM} — {DATE_TO}")
    print("Загрузка данных из Adesk API…")

    try:
        result = analyze(client, DATE_FROM, DATE_TO)
    except RuntimeError as exc:
        print(f"\nОшибка при получении данных: {exc}")
        sys.exit(1)
    except requests.RequestException as exc:
        print(f"\nОшибка сети: {exc}")
        sys.exit(1)

    # Print summary
    print("\n— Результаты анализа —")
    print(f"  Транзакций всего:            {result.total_transactions}")
    print(f"  Удалённые операции:          {len(result.deleted_ops)}")
    print(f"  Правки в закрытых периодах:  {len(result.closed_period_edits)}")
    print(f"  Ручной ввод:                 {len(result.manual_ops)}")
    print(f"  Без категории:               {len(result.no_category_ops)}")
    print(f"  На завершённые проекты:      {len(result.completed_project_ops)}")
    print(f"  Расхождения остатков:        {len(result.balance_discrepancies)}")
    print(f"  Счетов проверено:            {len(result.accounts)}")

    # Output filename
    safe_client = CLIENT_NAME.replace(" ", "_").replace("/", "_")
    filename = f"Аудит_Adesk_{safe_client}_{DATE_FROM}.pdf"
    output_path = os.path.join(OUTPUT_DIR, filename)

    print(f"\nФормирование PDF-отчёта…")
    try:
        generate_pdf(
            result=result,
            client_name=CLIENT_NAME,
            date_from=DATE_FROM,
            date_to=DATE_TO,
            auditor=AUDITOR_NAME,
            output_path=output_path,
        )
    except Exception as exc:
        print(f"Ошибка при генерации PDF: {exc}")
        raise

    print(f"Отчёт сохранён: {os.path.abspath(output_path)}")


if __name__ == "__main__":
    main()
