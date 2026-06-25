"""Fix TypeError: SelectKBest.__init__() got an unexpected keyword argument 'random_state'
SelectKBest does not accept random_state. Pass it to mutual_info_classif via functools.partial."""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

# Find cell 31 and fix the SelectKBest mutual_info line
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))
    if "SelectKBest(mutual_info_classif" in src and "random_state=42" in src:
        old = "kb_mi   = SelectKBest(mutual_info_classif, k=8, random_state=42).fit(X_fs, y_fs)"
        new = ("from functools import partial\n"
               "kb_mi   = SelectKBest(partial(mutual_info_classif, random_state=42), k=8).fit(X_fs, y_fs)")
        if isinstance(cell["source"], list):
            cell["source"] = "".join(cell["source"]).replace(old, new)
        else:
            cell["source"] = cell["source"].replace(old, new)
        cell["outputs"] = []
        cell["execution_count"] = None
        print(f"Fixed cell {i}")
        break

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)
print("DONE")
