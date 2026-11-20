import sys, datetime
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill, Border, Side, Alignment
from openpyxl.worksheet.table import Table, TableStyleInfo
wb = Workbook(); ws = wb.active; ws.title = "Angebote"
kopf = ["Posten", "Preis", "Anteil", "Datum", "Link", "Notiz"]
ws.append(kopf)
zeilen = [
 ["Beamer", 899.5, 0.789, datetime.date(2026, 5, 12), "https://example.org/beamer", "wichtig"],
 ["Leinwand", 101, 0.0886, datetime.date(2026, 6, 1), "Shop", "kursiv"],
 ["Kabel", 25, 0.0219, datetime.date(2026, 6, 15), None, "unterstrichen"],
 ["Stativ", 1234567.891, 0.1, datetime.date(2027, 1, 3), "Mail", "Mehrzeiliger Text der umbricht und lang ist"],
]
for z in zeilen: ws.append(z)
ws["E3"].hyperlink = "https://example.org/shop?x=1&y=2"; ws["E3"].style = "Hyperlink"
ws["E2"].hyperlink = "https://example.org/beamer"; ws["E2"].style = "Hyperlink"
ws["E5"].hyperlink = "mailto:info@example.org"; ws["E5"].style = "Hyperlink"
ws["E4"] = '=HYPERLINK("https://example.org/kabel","Kabel ansehen")'
ws["A6"] = "Summe"; ws["B6"] = "=SUM(B2:B5)"
dünn = Side(style="thin", color="FF000000"); dick = Side(style="medium", color="FF1F4E79")
for c in ws[1]:
    c.font = Font(bold=True, color="FFFFFFFF", size=12); c.fill = PatternFill("solid", fgColor="FF1F4E79"); c.alignment = Alignment(horizontal="center", vertical="center")
    c.border = Border(bottom=dick)
for r in ws.iter_rows(min_row=2, max_row=5):
    for c in r: c.border = Border(left=dünn, right=dünn, top=dünn, bottom=dünn)
for r in range(2, 7):
    ws[f"B{r}"].number_format = '#,##0.00 "€"'
    ws[f"C{r}"].number_format = '0.0%'
    ws[f"D{r}"].number_format = 'DD.MM.YYYY'
ws["A2"].font = Font(bold=True); ws["F3"].font = Font(italic=True, color="FFC00000"); ws["F4"].font = Font(underline="single"); ws["F2"].font = Font(strike=True)
ws["A3"].fill = PatternFill("solid", fgColor="FFFFF2CC"); ws["A4"].fill = PatternFill("solid", fgColor="FFE2EFDA")
ws["F5"].alignment = Alignment(wrap_text=True, vertical="top")
ws["B6"].font = Font(bold=True); ws["A6"].font = Font(bold=True); ws["B6"].border = Border(top=Side(style="double", color="FF000000"))
ws["A8"] = "Verbundene Überschrift"; ws.merge_cells("A8:C8"); ws["A8"].alignment = Alignment(horizontal="center"); ws["A8"].fill = PatternFill("solid", fgColor="FFDDEBF7")
ws["A9"] = 0.5; ws["A9"].number_format = "0%"; ws["B9"] = 1234.5; ws["B9"].number_format = "#,##0"; ws["C9"] = 3; ws["C9"].number_format = "0.000"
ws["D9"] = datetime.datetime(2026, 5, 12, 14, 30); ws["D9"].number_format = "DD.MM.YYYY HH:MM"; ws["E9"] = -42.5; ws["E9"].number_format = '#,##0.00;[Red]-#,##0.00'
ws["F9"] = 12; ws["F9"].number_format = '0 "Stück"'
ws.column_dimensions["A"].width = 14; ws.column_dimensions["E"].width = 26; ws.column_dimensions["F"].width = 30; ws.row_dimensions[5].height = 45
ws.freeze_panes = "A2"
ws.auto_filter.ref = "A1:F5"
wb.save(sys.argv[1])
