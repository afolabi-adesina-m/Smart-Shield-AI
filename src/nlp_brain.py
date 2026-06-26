"""NLP Brain (Pillar 1) — TF-IDF risk scoring for Ontario 511-style alerts."""

from __future__ import annotations

import re
from typing import Dict, List, Tuple

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer

# Hazard lexicon aligned with Ontario 511 / winter highway alerts
HAZARD_TERMS = {
    "ice", "black ice", "blizzard", "snow", "whiteout", "collision", "crashes",
    "crash", "closed", "closure", "hazard", "slippery", "fog", "multi-vehicle",
    "stall", "disabled", "accident", "warning", "storm", "freezing", "squall",
}

# Sample alerts mapped to live test-case scenarios (TC-1 … TC-5)
SCENARIO_ALERTS: Dict[str, str] = {
    "TC-1 Clear rush-hour (401 Jul 5pm)": (
        "Hwy 401 eastbound Mississauga: moderate traffic flow. Road surface clear. "
        "No weather advisories in effect."
    ),
    "TC-2 Blizzard night (Hwy400 Jan 2am)": (
        "Hwy 400 north of Barrie: blizzard conditions. Black ice reported. "
        "Multiple vehicle collisions. Highway partially closed."
    ),
    "TC-3 Wet dawn bicycle (Hwy7 Apr 6am)": (
        "Hwy 7 eastbound: light rain at dawn. Wet pavement. Reduced visibility. "
        "Cyclist struck — emergency crews on scene."
    ),
    "TC-4 Clear Sunday (Hwy115 Jun 9am)": (
        "Hwy 115 Peterborough: clear skies Sunday morning. Dry road surface. "
        "Normal traffic conditions."
    ),
    "TC-5 Ice storm rush (QEW Feb 5pm)": (
        "QEW Toronto bound: ice storm warning. Freezing rain and black ice. "
        "Multi-vehicle collision at rush hour. Hazardous driving conditions."
    ),
}

CORPUS = list(SCENARIO_ALERTS.values())


def clean_alert(text: str) -> str:
    text = text.lower()
    text = re.sub(r"[^a-z0-9\s\-]", " ", text)
    return re.sub(r"\s+", " ", text).strip()


def fit_tfidf(corpus: List[str] = None) -> TfidfVectorizer:
    """Fit TF-IDF on alert corpus."""
    corpus = corpus or CORPUS
    vec = TfidfVectorizer(ngram_range=(1, 2), min_df=1, stop_words="english")
    vec.fit([clean_alert(t) for t in corpus])
    return vec


def t_score_from_text(text: str, vectorizer: TfidfVectorizer) -> float:
    """
    NLP risk score T in [0, 1].
    Sum TF-IDF weights for hazard terms, scaled by corpus max.
    """
    cleaned = clean_alert(text)
    matrix = vectorizer.transform([cleaned])
    names = vectorizer.get_feature_names_out()
    scores = matrix.toarray()[0]

    hazard_score = 0.0
    for i, name in enumerate(names):
        if any(h in name for h in HAZARD_TERMS):
            hazard_score += scores[i]

    # Normalize against max possible on training corpus
    corpus_scores = []
    for doc in CORPUS:
        m = vectorizer.transform([clean_alert(doc)])
        s = m.toarray()[0]
        cs = sum(s[i] for i, n in enumerate(names) if any(h in n for h in HAZARD_TERMS))
        corpus_scores.append(cs)
    max_ref = max(corpus_scores) if corpus_scores else 1.0
    return float(np.clip(hazard_score / max(max_ref, 1e-6), 0, 1))


def score_all_scenarios(vectorizer: TfidfVectorizer = None) -> List[Tuple[str, str, float]]:
    """Return (scenario_id, alert_snippet, T_score) for each test case."""
    vectorizer = vectorizer or fit_tfidf()
    rows = []
    for name, alert in SCENARIO_ALERTS.items():
        rows.append((name, alert[:80] + "...", t_score_from_text(alert, vectorizer)))
    return rows
