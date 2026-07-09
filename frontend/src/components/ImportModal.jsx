import React, { useState } from 'react';
import api, { downloadImportReport } from '../api';

const ImportModal = ({ isOpen, onClose, onImportComplete, groupId }) => {
  const [file, setFile] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [error, setError] = useState('');
  const [reviewRows, setReviewRows] = useState([]);
  const [downloading, setDownloading] = useState(false);

  const handleImport = async (e) => {
    e.preventDefault();
    if (!file) {
      setError('Please select a CSV file');
      return;
    }

    setLoading(true);
    setError('');

    const formData = new FormData();
    formData.append('csv', file);
    formData.append('groupId', groupId);

    try {
      const res = await api.post('/api/import', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      
      setImportResult(res.data);
      
      if (res.data.needsReviewRows && res.data.needsReviewRows.length > 0) {
        setReviewRows(res.data.needsReviewRows);
      }
      
      // Pass the result with the import ID if available
      onImportComplete({
        ...res.data,
        importId: res.data.import_id || null
      });
    } catch (err) {
      setError(err.response?.data?.error || 'Import failed');
    } finally {
      setLoading(false);
    }
  };

  const handleResolveReview = async (row, payerName) => {
    try {
      await api.post('/api/import/review', {
        groupId,
        rowData: row.data,
        resolvedPayer: payerName
      });
      
      setReviewRows(reviewRows.filter(r => r.row !== row.row));
      
      if (importResult) {
        setImportResult({
          ...importResult,
          imported: importResult.imported + 1,
          needsReview: importResult.needsReview - 1
        });
      }
    } catch (err) {
      setError('Error resolving review: ' + (err.response?.data?.error || err.message));
    }
  };

  const handleDownloadReport = async () => {
    if (!importResult || !importResult.import_id) {
      setError('No import ID available for download');
      return;
    }

    setDownloading(true);
    try {
      const result = await downloadImportReport(importResult.import_id);
      if (result.success) {
        // Success - the file will download automatically
        setError('');
      } else {
        setError('Failed to download report: ' + (result.error || 'Unknown error'));
      }
    } catch (err) {
      setError('Error downloading report: ' + (err.message || 'Unknown error'));
    } finally {
      setDownloading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>📥 Import CSV</h2>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {!importResult ? (
          <form onSubmit={handleImport}>
            <div className="modal-body">
              <p>Upload the <code>expenses_export.csv</code> file. The app will detect anomalies and show you a report.</p>
              
              <div className="import-area">
                <input 
                  type="file" 
                  accept=".csv" 
                  onChange={(e) => setFile(e.target.files[0])}
                  required
                />
                {file && <span className="file-name">📄 {file.name}</span>}
              </div>
              
              {error && <div className="error-message">{error}</div>}
            </div>
            
            <div className="modal-footer">
              <button type="button" className="btn btn-outline" onClick={onClose}>
                Cancel
              </button>
              <button type="submit" className="btn btn-success" disabled={loading}>
                {loading ? '⏳ Importing...' : '⬆️ Import'}
              </button>
            </div>
          </form>
        ) : (
          <div className="modal-body">
            {/* Import Results */}
            <div className="import-results">
              <h3>📋 Import Report</h3>
              
              <div className="result-stats">
                <div className="stat-item success">
                  <span className="stat-number">{importResult.imported || 0}</span>
                  <span className="stat-label">Imported</span>
                </div>
                <div className="stat-item error">
                  <span className="stat-number">{importResult.skipped || 0}</span>
                  <span className="stat-label">Skipped</span>
                </div>
                <div className="stat-item info">
                  <span className="stat-number">{importResult.settlements || 0}</span>
                  <span className="stat-label">Settlements</span>
                </div>
                <div className="stat-item warning">
                  <span className="stat-number">{importResult.needsReview || 0}</span>
                  <span className="stat-label">Needs Review</span>
                </div>
              </div>

              {/* Download Report Button */}
              {importResult.import_id && (
                <div style={{ marginTop: 16, display: 'flex', justifyContent: 'center' }}>
                  <button 
                    className="btn btn-primary" 
                    onClick={handleDownloadReport}
                    disabled={downloading}
                    style={{ 
                      padding: '10px 24px',
                      fontSize: '14px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px'
                    }}
                  >
                    {downloading ? (
                      <>
                        <span>⏳</span> Downloading...
                      </>
                    ) : (
                      <>
                        <span>📥</span> Download Report
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>

            {/* Review Rows */}
            {reviewRows.length > 0 && (
              <div className="review-section">
                <h4>⚠️ Rows Needing Review</h4>
                {reviewRows.map((row, idx) => (
                  <div className="review-item" key={idx}>
                    <h5>Row {row.row}: {row.description}</h5>
                    <ul>
                      {row.anomalies.map((a, i) => (
                        <li key={i}>{a.message}</li>
                      ))}
                    </ul>
                    <div className="review-actions">
                      <input
                        type="text"
                        placeholder="Enter payer name (e.g., Aisha)"
                        id={`payer-${row.row}`}
                      />
                      <button
                        className="btn btn-success btn-sm"
                        onClick={() => {
                          const payer = document.getElementById(`payer-${row.row}`).value.trim();
                          if (payer) {
                            handleResolveReview(row, payer);
                          } else {
                            alert('Please enter a payer name');
                          }
                        }}
                      >
                        Resolve
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* All Anomalies */}
            {importResult.anomalies && importResult.anomalies.length > 0 && (
              <div className="anomalies-section">
                <h4>⚠️ All Anomalies</h4>
                <div className="table-wrapper">
                  <table className="anomaly-table">
                    <thead>
                      <tr>
                        <th>Row</th>
                        <th>Description</th>
                        <th>Anomaly</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importResult.anomalies
                        .filter(a => a.anomalies && a.anomalies.length > 0)
                        .map((a, i) => (
                          <tr key={i}>
                            <td>{a.row}</td>
                            <td>{a.description}</td>
                            <td>{a.anomalies[0]?.type || 'N/A'}</td>
                            <td>
                              <span className={`action-badge ${a.action}`}>
                                {a.action}
                              </span>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="modal-footer">
              <button 
                className="btn btn-primary" 
                onClick={() => { 
                  onClose(); 
                  window.location.reload(); 
                }}
              >
                Done
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default ImportModal;