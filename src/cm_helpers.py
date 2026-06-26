"""Plot confusion matrices: raw counts + row-normalized (percent per true class)."""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import confusion_matrix, ConfusionMatrixDisplay


def plot_confusion_matrices_pair(
    y_true,
    y_pred,
    labels: Sequence[str],
    title_prefix: str,
    cmap: str = "Blues",
    figsize: Tuple[float, float] = (12, 5),
) -> Tuple[np.ndarray, np.ndarray]:
    """
    Show two side-by-side confusion matrices:
      • Without Normalization (raw counts)
      • With Normalization (row %, i.e. recall per true class)
    """
    classes = list(range(len(labels)))
    cm_raw = confusion_matrix(y_true, y_pred, labels=classes)
    cm_norm = confusion_matrix(y_true, y_pred, labels=classes, normalize="true")

    fig, axes = plt.subplots(1, 2, figsize=figsize)

    ConfusionMatrixDisplay(cm_raw, display_labels=labels).plot(
        ax=axes[0], cmap=cmap, colorbar=True, values_format="d"
    )
    axes[0].set_title(f"{title_prefix}\nWithout Normalization (Counts)", fontweight="bold")

    ConfusionMatrixDisplay(cm_norm, display_labels=labels).plot(
        ax=axes[1], cmap=cmap, colorbar=True, values_format=".2f"
    )
    axes[1].set_title(f"{title_prefix}\nWith Normalization (Row %)", fontweight="bold")

    plt.tight_layout()
    plt.show()
    return cm_raw, cm_norm
