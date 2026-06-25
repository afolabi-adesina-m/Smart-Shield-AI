"""
Fix corrupted PyTorch:
1. Cell 3  – deeper torch validation (test __version__, zeros, optim.Adam)
2. Cell 46 – wrap entire DNN section in try/except so it skips cleanly
"""
import json, os

NB_PATH = os.path.join(os.path.dirname(__file__), "Captone - Draft.ipynb")
with open(NB_PATH, encoding="utf-8") as f:
    nb = json.load(f)

# ── Fix 1: Cell 3 – stricter torch validation ─────────────────────────────────
TORCH_BLOCK_OLD = """\
# Optional: PyTorch
# Catches both ImportError (not installed) and OSError/WinError (broken DLL)
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    TORCH_OK = True
    print(f"PyTorch available  (version {torch.__version__})")
except (ImportError, OSError, Exception) as _torch_err:
    TORCH_OK = False
    torch = None
    print(f"PyTorch unavailable ({type(_torch_err).__name__}: {str(_torch_err)[:80]})")
    print("  -> pip install torch   OR reinstall torch in current environment")
    print("  -> DNN section will be skipped; all sklearn models still run.")\
"""

TORCH_BLOCK_NEW = """\
# Optional: PyTorch  (full validation – catches partial/corrupted installs)
try:
    import torch
    import torch.nn as nn
    import torch.optim as optim
    from torch.utils.data import DataLoader, TensorDataset
    # Validate the install is not partially corrupted
    _ver  = torch.__version__           # AttributeError if broken
    _t    = torch.zeros(2)              # RuntimeError if ops broken
    _lin  = nn.Linear(2, 2)            # check nn works
    _opt  = optim.Adam(_lin.parameters(), lr=1e-3, weight_decay=1e-4)  # check optim works
    del _t, _lin, _opt
    TORCH_OK = True
    print(f"PyTorch available  (version {_ver})")
except (ImportError, OSError, AttributeError, RuntimeError, Exception) as _torch_err:
    TORCH_OK = False
    torch = None; nn = None; optim = None
    DataLoader = None; TensorDataset = None
    print(f"PyTorch unavailable ({type(_torch_err).__name__}: {str(_torch_err)[:80]})")
    print("  To fix: conda activate ai_work_final")
    print("          pip uninstall torch -y")
    print("          pip install torch --index-url https://download.pytorch.org/whl/cpu")
    print("  -> DNN section will be skipped; all sklearn models still run.")\
"""

# ── Fix 2: Cell 46 – wrap DNN in try/except ──────────────────────────────────
DNN_BLOCK_OLD = "# ── 8.4 PyTorch DNN ─────────────────────────────────────────────────────────\n# TORCH_OK was set in Cell 3"

DNN_GUARD = """\
# ── 8.4 PyTorch DNN ─────────────────────────────────────────────────────────
# TORCH_OK was set in Cell 3 — catches ImportError, OSError, and partial installs
dnn_result = None
device     = None

if not TORCH_OK:
    print("PyTorch unavailable (TORCH_OK=False). DNN section skipped.")
    print("All sklearn models are unaffected.")
else:
    try:\
"""

changes = 0
for i, cell in enumerate(nb["cells"]):
    src = "".join(cell.get("source", ""))

    # Fix 1 – Cell 3 torch block
    if TORCH_BLOCK_OLD in src:
        cell["source"] = src.replace(TORCH_BLOCK_OLD, TORCH_BLOCK_NEW)
        cell["outputs"] = []; cell["execution_count"] = None
        print(f"Cell {i}: torch validation block updated")
        changes += 1

    # Fix 2 – Cell 46 DNN guard
    if "# ── 8.4 PyTorch DNN" in src and "dnn_result = None" not in src:
        # Wrap the body under an if TORCH_OK / try block
        new_src = """\
# ── 8.4 PyTorch DNN ──────────────────────────────────────────────────────────
# TORCH_OK validated in Cell 3 (checks __version__, zeros, optim.Adam)
dnn_result = None
device     = None

if not TORCH_OK:
    print("PyTorch unavailable (TORCH_OK=False). DNN section skipped.")
    print("All sklearn models are unaffected.")
else:
    try:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        print(f"PyTorch device : {device}")

        X_tr_t = torch.FloatTensor(X_train_sc).to(device)
        y_tr_t = torch.LongTensor(y_train_sm).to(device)
        X_te_t = torch.FloatTensor(X_test_sc).to(device)
        y_te_t = torch.LongTensor(y_test).to(device)

        cc = np.bincount(y_train_sm, minlength=3).astype(float)
        cw = torch.FloatTensor(1.0/(cc+1e-6)).to(device)
        cw = cw / cw.sum() * 3

        train_ds = TensorDataset(X_tr_t, y_tr_t)
        train_dl = DataLoader(train_ds, batch_size=256, shuffle=True)

        class ShieldDNN(nn.Module):
            def __init__(self, n_in, n_out, p=0.3):
                super().__init__()
                self.net = nn.Sequential(
                    nn.Linear(n_in, 256), nn.BatchNorm1d(256), nn.ReLU(), nn.Dropout(p),
                    nn.Linear(256, 128),  nn.BatchNorm1d(128), nn.ReLU(), nn.Dropout(p),
                    nn.Linear(128, 64),   nn.BatchNorm1d(64),  nn.ReLU(), nn.Dropout(p),
                    nn.Linear(64, n_out)
                )
            def forward(self, x): return self.net(x)

        model_dnn = ShieldDNN(X_train_sc.shape[1], 3).to(device)
        criterion = nn.CrossEntropyLoss(weight=cw)
        optimizer = optim.Adam(model_dnn.parameters(), lr=1e-3, weight_decay=1e-4)
        scheduler = optim.lr_scheduler.ReduceLROnPlateau(optimizer, "min", patience=5, factor=0.5)

        EPOCHS, PATIENCE = 80, 10
        best_val, wait, best_state = float("inf"), 0, None
        t_losses, v_losses = [], []

        print(f"Training for up to {EPOCHS} epochs (early stop patience={PATIENCE})...")
        for epoch in range(EPOCHS):
            model_dnn.train()
            ep_loss = 0.0
            for xb, yb in train_dl:
                optimizer.zero_grad()
                loss = criterion(model_dnn(xb), yb)
                loss.backward(); optimizer.step()
                ep_loss += loss.item() * len(xb)
            ep_loss /= len(train_ds)
            model_dnn.eval()
            with torch.no_grad():
                vl = criterion(model_dnn(X_te_t), y_te_t).item()
            scheduler.step(vl)
            t_losses.append(ep_loss); v_losses.append(vl)
            if vl < best_val:
                best_val   = vl
                best_state = {k: v.clone() for k, v in model_dnn.state_dict().items()}
                wait = 0
            else:
                wait += 1
                if wait >= PATIENCE:
                    print(f"  Early stop at epoch {epoch+1}")
                    break
            if (epoch+1) % 10 == 0:
                print(f"  Ep {epoch+1:3d} | train={ep_loss:.4f} | val={vl:.4f}")

        model_dnn.load_state_dict(best_state)
        print("Best weights restored.")

        plt.figure(figsize=(9,4))
        plt.plot(t_losses, label="Train loss", color="#4C72B0")
        plt.plot(v_losses, label="Val loss",   color="#DD8452")
        plt.title("DNN Training Curve", fontweight="bold")
        plt.xlabel("Epoch"); plt.ylabel("Loss"); plt.legend()
        plt.tight_layout(); plt.show()

        model_dnn.eval()
        with torch.no_grad():
            logits = model_dnn(X_te_t)
            probs  = torch.softmax(logits, dim=1).cpu().numpy()
            preds  = logits.argmax(dim=1).cpu().numpy()

        dnn_result = {"Model":"PyTorch DNN",
            "Accuracy" : round(accuracy_score(y_test, preds), 4),
            "Prec (M)" : round(precision_score(y_test, preds, average="macro", zero_division=0), 4),
            "Rec (M)"  : round(recall_score(y_test, preds, average="macro", zero_division=0), 4),
            "F1 (M)"   : round(f1_score(y_test, preds, average="macro", zero_division=0), 4),
            "F1 (W)"   : round(f1_score(y_test, preds, average="weighted", zero_division=0), 4),
            "MCC"      : round(matthews_corrcoef(y_test, preds), 4),
            "AUC (OvR)": round(roc_auc_score(y_test, probs, multi_class="ovr", average="macro"), 4),
            "_model"   : model_dnn}

        print(f"DNN: Acc={dnn_result['Accuracy']}  Rec(M)={dnn_result['Rec (M)']}  "
              f"F1={dnn_result['F1 (M)']}  MCC={dnn_result['MCC']}")
        print(classification_report(y_test, preds,
              target_names=["PD-Only","Injury","Fatal"], zero_division=0))

        cm = confusion_matrix(y_test, preds)
        ConfusionMatrixDisplay(cm, display_labels=["PD-Only","Injury","Fatal"]).plot(cmap="Blues")
        plt.title("Confusion Matrix - PyTorch DNN", fontweight="bold")
        plt.tight_layout(); plt.show()

    except Exception as _dnn_err:
        print(f"DNN training failed: {type(_dnn_err).__name__}: {_dnn_err}")
        print("Skipping DNN — all sklearn models still run.")
        dnn_result = None\
"""
        cell["source"] = new_src
        cell["outputs"] = []; cell["execution_count"] = None
        print(f"Cell {i}: DNN cell wrapped in try/except")
        changes += 1

with open(NB_PATH, "w", encoding="utf-8") as f:
    json.dump(nb, f, indent=1, ensure_ascii=False)

print(f"\nDONE — {changes} cells updated.")
