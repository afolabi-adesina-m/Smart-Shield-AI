import re
from pathlib import Path
text = Path(__file__).resolve().parent.parent.joinpath("notebooks/capstone_with_results.ipynb").read_text(encoding="utf-8")
urls = sorted(set(re.findall(r"https?://[^\s\)\\\"\]]+", text)))
Path(__file__).resolve().parent.joinpath("_urls.txt").write_text("\n".join(urls), encoding="utf-8")
