import { useState } from 'react';
import { uploadMovementPlan } from '../api';

function CSVUploadPanel() {
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });
  const [result, setResult] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.name.endsWith('.csv')) {
      setMessage({ type: 'error', text: 'Please select a CSV file' });
      return;
    }

    setIsLoading(true);
    setMessage({ type: '', text: '' });
    setResult(null);

    try {
      const response = await uploadMovementPlan(file);
      setResult(response);
      setMessage({
        type: 'success',
        text: `✓ Successfully imported ${response.imported_rows} rows with ${response.total_movements} movements`
      });
    } catch (error) {
      setMessage({
        type: 'error',
        text: `✗ ${error.message}`
      });
    } finally {
      setIsLoading(false);
      e.target.value = '';
    }
  };

  return (
    <div className="glass-panel" style={{
      position: 'absolute',
      bottom: '20px',
      right: '20px',
      padding: '16px',
      width: '320px',
      display: 'flex',
      flexDirection: 'column',
      gap: '12px',
      zIndex: 100
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '4px'
      }}>
        <span style={{
          fontSize: '1.2rem'
        }}>
          📊
        </span>
        <span style={{
          color: 'var(--text-secondary)',
          fontSize: '0.85rem',
          fontWeight: 600
        }}>
          Movement Plan
        </span>
      </div>

      <label style={{
        display: 'block',
        cursor: isLoading ? 'not-allowed' : 'pointer'
      }}>
        <input
          type="file"
          accept=".csv"
          onChange={handleFileChange}
          disabled={isLoading}
          style={{
            display: 'none'
          }}
        />
        <button
          onClick={(e) => e.currentTarget.parentElement.querySelector('input').click()}
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '10px 12px',
            background: 'rgba(59, 130, 246, 0.2)',
            border: '1px solid rgba(59, 130, 246, 0.5)',
            color: 'var(--accent-blue)',
            borderRadius: '8px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            fontWeight: 600,
            fontSize: '0.9rem',
            transition: 'all 0.2s',
            opacity: isLoading ? 0.6 : 1
          }}
        >
          {isLoading ? '⏳ Uploading...' : '📁 Upload CSV'}
        </button>
      </label>

      {message.text && (
        <div style={{
          padding: '8px 10px',
          borderRadius: '6px',
          fontSize: '0.85rem',
          backgroundColor: message.type === 'error'
            ? 'rgba(239, 68, 68, 0.1)'
            : 'rgba(16, 185, 129, 0.1)',
          border: `1px solid ${message.type === 'error'
            ? 'rgba(239, 68, 68, 0.3)'
            : 'rgba(16, 185, 129, 0.3)'}`,
          color: message.type === 'error'
            ? '#fca5a5'
            : '#6ee7b7'
        }}>
          {message.text}
        </div>
      )}

      {result && (
        <details style={{
          fontSize: '0.75rem',
          color: 'var(--text-secondary)',
          cursor: 'pointer'
        }}>
          <summary style={{
            fontWeight: 600,
            marginBottom: '8px',
            padding: '6px',
            borderRadius: '4px',
            background: 'rgba(255, 255, 255, 0.05)',
            userSelect: 'none'
          }}>
            View Details
          </summary>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '6px',
            paddingLeft: '8px',
            borderLeft: '2px solid rgba(255, 255, 255, 0.1)',
            marginTop: '8px'
          }}>
            <div>📈 Rows imported: <strong>{result.imported_rows}</strong></div>
            <div>🚶 Total movements: <strong>{result.total_movements}</strong></div>
            {result.row_summaries && result.row_summaries.length > 0 && (
              <div style={{
                maxHeight: '120px',
                overflowY: 'auto',
                marginTop: '8px',
                paddingTop: '8px',
                borderTop: '1px solid rgba(255, 255, 255, 0.1)'
              }}>
                {result.row_summaries.map((summary, idx) => (
                  <div key={idx} style={{
                    fontSize: '0.7rem',
                    padding: '4px',
                    marginBottom: '4px',
                    background: 'rgba(255, 255, 255, 0.03)',
                    borderRadius: '3px'
                  }}>
                    <div><strong>{summary.venue}</strong></div>
                    <div>{summary.start_time} - {summary.end_time}, {summary.groups_scheduled} groups</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

export default CSVUploadPanel;
