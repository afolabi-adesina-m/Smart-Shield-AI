"""Second pass: fix broken portal URLs in capstone_with_results.ipynb."""
import json
import urllib.request
from pathlib import Path

NOTEBOOK = Path(__file__).resolve().parent.parent / "notebooks" / "capstone_with_results.ipynb"

REPLACEMENTS = {
    "https://511on.ca/about/open-data": "http://511on.ca/developers/resources",
    "https://511on.ca/developers": "http://511on.ca/developers/resources",
    "https://dd.weather.gc.ca/citypage_weather/xml/ON/": "https://dd.weather.gc.ca/today/citypage_weather/ON/",
    "https://www.kaggle.com/datasets/birdy654/road-surface-classification": "https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD",
    "https://www.kaggle.com/datasets/vipinmazumder/road-surface-classification": "https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD",
    "Visual Training Data:** [Kaggle: Road Surface Classification]": "Visual Training Data:** [HuggingFace RSCD Road Surface Dataset]",
}

PORTAL_TABLE_FIX = """| Ontario 511 Open Data | http://511on.ca/developers/resources | API / alert text for NLP Brain |
| Environment Canada | https://dd.weather.gc.ca/today/citypage_weather/ON/ | Weather XML for E_index |"""

text = NOTEBOOK.read_text(encoding="utf-8")
for old, new in REPLACEMENTS.items():
    text = text.replace(old, new)

text = text.replace(
    "| Ontario 511 Open Data | https://511on.ca/about/open-data | API / alert text for NLP Brain |",
    "| Ontario 511 Open Data | http://511on.ca/developers/resources | API / alert text for NLP Brain |",
)
text = text.replace(
    "| Environment Canada | https://dd.weather.gc.ca/citypage_weather/xml/ON/ | Weather XML for E_index |",
    "| Environment Canada | https://dd.weather.gc.ca/today/citypage_weather/ON/ | Weather XML for E_index |",
)
text = text.replace(
    "| HuggingFace RSCD | https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD | Road image scale-up (optional) |",
    "| HuggingFace RSCD | https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD | Road image training scale-up |",
)

NOTEBOOK.write_text(text, encoding="utf-8")
print("URL pass 2 done")

urls = [
    "http://511on.ca/developers/resources",
    "https://511on.ca/map",
    "https://dd.weather.gc.ca/today/citypage_weather/ON/",
    "https://data.ontario.ca/dataset?q=collision",
    "https://open.toronto.ca/dataset/police-annual-statistical-report-traffic-collisions/",
    "https://itsslab.com/",
    "https://huggingface.co/datasets/RoadSurfaceClassDataset/RSCD",
]
for u in urls:
    try:
        req = urllib.request.Request(u, method="HEAD", headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=15) as r:
            print(f"OK {r.status} {u}")
    except Exception:
        try:
            req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=15) as r:
                print(f"OK GET {r.status} {u}")
        except Exception as e:
            print(f"FAIL {u}: {e}")
