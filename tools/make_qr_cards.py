"""characters.json -> print/qr_cards.html (A4 인쇄용 QR 카드 16장)
실행: python tools/make_qr_cards.py   (차토체스 폴더에서)
"""
import json, html
from pathlib import Path
import segno

ROOT = Path(__file__).resolve().parent.parent
data = json.loads((ROOT / "data" / "characters.json").read_text(encoding="utf-8"))
chars = data["characters"]

TEAMS = [
    ("p1", "P1", "RED", "#d6333f", "#fde8ea"),
    ("p2", "P2", "BLUE", "#2563d6", "#e6eefc"),
]


def qr_svg(text):
    q = segno.make(text, error="h", micro=False)
    return q.svg_inline(scale=1, border=2, dark="#000", light="#fff", omitsize=True)


def card(c, team):
    key, label, color_name, color, tint = team
    code = c["qr"][key]
    row = "앞줄" if c["row"] == "front" else "뒷줄"
    return f"""
    <div class="card" style="--c:{color};--t:{tint}">
      <div class="qr">{qr_svg(code)}</div>
      <div class="info">
        <div class="team">{label} · {color_name}</div>
        <div class="icon">{c['icon']}</div>
        <div class="name">{html.escape(c['name'])}</div>
        <div class="role">{html.escape(c['role'])} · {row}</div>
        <div class="code">{code}</div>
      </div>
    </div>"""


pages = []
for team in TEAMS:
    cards = "".join(card(c, team) for c in chars)
    pages.append(f'<section class="page"><div class="grid">{cards}</div></section>')

out = f"""<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>차토체스 QR 카드</title>
<style>
  @page {{ size: A4; margin: 10mm; }}
  * {{ box-sizing: border-box; }}
  body {{ margin: 0; background: #888; font-family: "Pretendard", "Malgun Gothic", sans-serif;
         -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
  .hint {{ max-width: 210mm; margin: 12px auto; color: #fff; font-size: 14px; }}
  .page {{ width: 210mm; height: 297mm; margin: 0 auto 12px; background: #fff; padding: 10mm;
          page-break-after: always; }}
  .page:last-child {{ page-break-after: auto; }}
  .grid {{ display: grid; grid-template-columns: repeat(2, 90mm); grid-auto-rows: 64mm;
          gap: 5mm 10mm; }}
  .card {{ border: 3mm solid var(--c); border-radius: 4mm; background: var(--t);
          display: flex; align-items: center; gap: 4mm; padding: 3mm; outline: 0.3mm dashed #999;
          outline-offset: 1.5mm; }}
  .qr {{ width: 46mm; height: 46mm; flex: none; background: #fff; border-radius: 2mm; padding: 1mm; }}
  .qr svg {{ width: 100%; height: 100%; display: block; }}
  .info {{ flex: 1; min-width: 0; text-align: center; }}
  .team {{ display: inline-block; background: var(--c); color: #fff; font-weight: 800;
          font-size: 9pt; padding: 0.6mm 2.5mm; border-radius: 3mm; letter-spacing: .5px; }}
  .icon {{ font-size: 30pt; line-height: 1.2; margin-top: 1mm;
          font-family: "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif; }}
  .name {{ font-size: 17pt; font-weight: 900; color: #222; }}
  .role {{ font-size: 8.5pt; color: #555; margin-top: .5mm; }}
  .code {{ font-size: 6pt; color: #999; margin-top: 1.5mm; font-family: Consolas, monospace; }}
  @media print {{
    body {{ background: none; }}
    .hint {{ display: none; }}
    .page {{ margin: 0; width: auto; height: auto; padding: 0; }}
  }}
</style></head><body>
<p class="hint">Ctrl+P → 용지 A4, 배율 100%(실제 크기), '배경 그래픽' 켜고 인쇄하세요. 1쪽은 빨강(P1), 2쪽은 파랑(P2) 세트입니다. 점선을 따라 자르면 돼요.</p>
{''.join(pages)}
</body></html>"""

dst = ROOT / "print" / "qr_cards.html"
dst.parent.mkdir(exist_ok=True)
dst.write_text(out, encoding="utf-8")
print("wrote", dst)
