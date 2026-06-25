"""
Fix KeyError: 'Mean_Persons' in the summary statistics plot cell (cell 16).
Root cause: bar_with_paper_ref() was passed a Series (tbl_weather["Mean_Persons"])
instead of the full DataFrame, then tried to re-index it with col="Mean_Persons".
Fix: pass the full DataFrame and let the function do the column selection.
"""
import json

NB_PATH = r"c:\Users\DELL\OneDrive - Sheridan College\Desktop\All Documents\PAIDA 2025 - 2026\SEMESTER 3\INFO53883 - AI & ML Capstone Project\Captone - Draft.ipynb"

with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

FIXED_PLOT_CELL = """\
# -- Visualise all three summary tables ----------------------------------------
fig, axes = plt.subplots(1, 3, figsize=(20, 6))
fig.suptitle(
    "Summary Statistics - DfT 2024\\n"
    "(Replicating Jiang et al. 2024 Factor Analysis on Our Dataset)",
    fontsize=13, fontweight="bold"
)

def bar_with_paper_ref(ax, df, col, title,
                       paper_ref_label=None, paper_ref_val=None,
                       color="#4C72B0"):
    vals = df[col].values
    labels = df.index.tolist()
    bars = ax.barh(labels, vals, color=color)
    ax.set_title(title, fontsize=10)
    ax.set_xlabel("Mean " + col.replace("_", " "))
    ax.invert_yaxis()
    for bar, val in zip(bars, vals):
        ax.text(val + 0.002, bar.get_y() + bar.get_height() / 2,
                f"{val:.3f}", va="center", fontsize=8)
    if paper_ref_val is not None:
        ax.axvline(paper_ref_val, color="red", linestyle="--",
                   linewidth=1.2, alpha=0.7)
        ax.text(paper_ref_val + 0.002, len(df) - 0.5,
                f"Paper ref\\n({paper_ref_label}: {paper_ref_val})",
                color="red", fontsize=7, va="bottom")

bar_with_paper_ref(
    axes[0], tbl_weather, "Mean_Persons",
    "Weather vs. Mean Casualties",
    paper_ref_label="Snowing (Paper 2)", paper_ref_val=1.421,
    color="#4C72B0"
)

bar_with_paper_ref(
    axes[1], tbl_rsc, "Mean_Persons",
    "Road Surface vs. Mean Casualties",
    paper_ref_label="Standing water (Paper 2)", paper_ref_val=1.417,
    color="#DD8452"
)

bar_with_paper_ref(
    axes[2], tbl_light, "Mean_Persons",
    "Lighting vs. Mean Casualties",
    paper_ref_label="Dusk (Paper 2)", paper_ref_val=1.558,
    color="#55A868"
)

plt.tight_layout()
plt.show()\
"""

# Replace cell 16 source
nb["cells"][16]["source"] = FIXED_PLOT_CELL
nb["cells"][16]["outputs"] = []
nb["cells"][16]["execution_count"] = None

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print("FIXED - cell 16 updated.")
print("Source preview:")
print(nb["cells"][16]["source"][:300])
