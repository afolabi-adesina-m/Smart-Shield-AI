import json
path = r'c:\Users\DELL\OneDrive - Sheridan College\Desktop\All Documents\PAIDA 2025 - 2026\SEMESTER 3\INFO53883 - AI & ML Capstone Project\Python Notebooks & Scripts\Captone - Draft.ipynb'
nb = json.load(open(path, encoding='utf-8'))
keywords = ['fair','ethic','bias','equit','rural','urban','disparit','protected','demographic','gender','age','race','geographic']
found = False
for i, cell in enumerate(nb['cells']):
    src = ''.join(cell.get('source', ''))
    hits = [k for k in keywords if k.lower() in src.lower()]
    if hits:
        found = True
        print(f"Cell {i} [{cell['cell_type']}]: {hits}")
        lines = [l for l in src.split('\n') if any(k in l.lower() for k in hits)]
        for l in lines[:4]:
            print(f"   {l[:130]}")
if not found:
    print("No fairness/ethics keywords found in notebook.")
