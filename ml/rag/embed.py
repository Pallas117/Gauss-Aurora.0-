import gc
from typing import Any

_model: Any = None

def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        _model = SentenceTransformer("all-MiniLM-L6-v2")
    return _model

def embed_texts(texts, batch_size=16):
    if not texts:
        return []
    model = get_model()
    out = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        vecs = model.encode(batch, convert_to_numpy=True)
        for j in range(len(batch)):
            out.append(vecs[j].tolist())
    return out

def embed_query(query):
    return embed_texts([query])[0]

def unload_model():
    global _model
    if _model is not None:
        del _model
        _model = None
    gc.collect()
