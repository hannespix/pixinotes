# Erzeugt pruefungen/daten/m411-links.xlsx (XlsxWriter schreibt wie Excel: Texte in der gemeinsamen Liste,
# Links als <hyperlink> mit Beziehung, Formeln mit ihrem zuletzt gerechneten Wert).
#   python3 -m pip install XlsxWriter && python3 pruefungen/daten/m411-links.py pruefungen/daten/m411-links.xlsx
import sys, xlsxwriter
wb = xlsxwriter.Workbook(sys.argv[1]); ws = wb.add_worksheet('Links')
for i, k in enumerate(['Name', 'Link', 'Nr', 'Formel']): ws.write(0, i, k)
ws.write('A2', 'Beamer');   ws.write_url('B2', 'https://example.org/beamer');                       ws.write('C2', 4711)
ws.write('A3', 'Leinwand'); ws.write_url('B3', 'https://example.org/leinwand', string='Zum Shop');  ws.write('C3', 4712)
ws.write('A4', 'Mail');     ws.write_url('B4', 'mailto:info@example.org', string='Schreiben')
ws.write('A5', 'Intern');   ws.write_url('B5', 'internal:Links!A1', string='Nach oben')
ws.write_url('B6', 'https://example.org/zahl', string='12345')                                     # Text aus Ziffern mit Link
ws.write_url('C7', 'https://example.org/nummer', string=''); ws.write_number('C7', 100234)          # Zahl mit Link
# zusammengesetzte Adresse, Text daneben
ws.write_formula('D2', '=HYPERLINK("https://example.org/t?id="&C2,"Auftrag "&C2)', value='Auftrag 4711')
# zusammengesetzte Adresse, angezeigt wird die Nummer selbst – der Fall aus der Meldung
ws.write_formula('D3', '=HYPERLINK("https://example.org/t?id="&C3,C3)', value=4712)
ws.write_formula('D4', '=HYPERLINK(B2)', value='https://example.org/beamer')
ws.write_formula('D5', '=HYPERLINK(B2,A2)', value='Beamer')
# der angezeigte Text rechnet hier nicht (unbekannte Funktion) – die Adresse schon
ws.write_formula('D6', '=HYPERLINK("https://example.org/x/"&C2,_xlfn.XLOOKUP(C2,C2:C3,A2:A3))', value='Beamer')
# weder noch: bleibt Text
ws.write_formula('D7', '=HYPERLINK(_xlfn.XLOOKUP(C2,C2:C3,B2:B3),"Ohne Ziel")', value='Ohne Ziel')
ws.write_formula('D8', '=IF(C2>0,HYPERLINK("https://example.org/wenn","Bedingt"),"")', value='Bedingt')
ws.write_formula('D9', '=D3', value=4712)                                                           # zeigt nur auf eine Link-Zelle
ws.write_formula('D10', '=HYPERLINK("javascript:alert(1)","Unsicher")', value='Unsicher')
wb.close()
