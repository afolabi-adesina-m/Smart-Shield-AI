# D4 Final Technical Report — Team 2B

Journal-style final report (Jiang et al. table/figure narration), **47 pages**, with live UI evidence and both reference papers cited throughout.

## Submit these

| File | Role |
|------|------|
| **D4_Final_Technical_Report_Team2B.pdf** | SLATE upload master (**47 pages**) |
| **D4_Final_Technical_Report_Team2B.docx** | Editable Word (full content, cleaned tables/refs; upload-ready) |
| **D4_Final_Technical_Report_Team2B.tex** | Editable LaTeX master (full extended appendices) |
| evidence/ | SYS-00…05 screenshots |

## Style

- Continuous prose (“Table X presents…”, “Figure Y illustrates…”)
- Primary stylistic model: Jiang et al. (2024) ML traffic paper
- Conceptual fusion anchor: Pennino & D’Amato (2024) SPI / weather routing
- Canadian English

## Compile

```bash
cd docs/D4
pdflatex D4_Final_Technical_Report_Team2B.tex
bibtex D4_Final_Technical_Report_Team2B
pdflatex D4_Final_Technical_Report_Team2B.tex
pdflatex D4_Final_Technical_Report_Team2B.tex
```
