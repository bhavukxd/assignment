# IMPORT_REPORT

The importer returns a JSON report:

- `rows`: number of parsed rows
- `accepted`: list of row indices accepted
- `rejected`: list of row indices rejected
- `anomalies`: list of anomaly objects
  - `rowIndex`, `type`, `severity`, `message`, `details`

This report is displayed in the UI and stored in backend responses.

