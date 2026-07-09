# DECISIONS

- Backend uses Express.
- Supabase is used for persistence.
- CSV parsing uses a deterministic parser (no LLM for correctness).
- The importer produces an `import_report` with anomalies and suggested corrections.
- Anomaly detection is heuristic + rule-based (deterministic, fast). 

