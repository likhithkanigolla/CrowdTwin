import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import './index.css'
import App from './App.jsx'

class AppErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, message: '' }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, message: error?.message || 'Unknown frontend error' }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Frontend runtime error:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: '100vh',
          display: 'grid',
          placeItems: 'center',
          background: '#f8fafc',
          color: '#0f172a',
          fontFamily: 'system-ui, sans-serif',
          padding: '24px',
        }}>
          <div style={{ maxWidth: '760px', width: '100%', background: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '12px', padding: '20px' }}>
            <h2 style={{ margin: '0 0 10px 0' }}>Frontend crashed</h2>
            <p style={{ margin: 0, opacity: 0.9 }}>
              A runtime error occurred. Open browser console for full stack trace.
            </p>
            <pre style={{ marginTop: '12px', whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f1f5f9', padding: '10px', borderRadius: '8px' }}>
              {this.state.message}
            </pre>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Navigate to="/visualize" replace />} />
          <Route path="/visualize" element={<App />} />
          <Route path="/actuate" element={<App />} />
          <Route path="/simulate" element={<App />} />
          <Route path="*" element={<Navigate to="/visualize" replace />} />
        </Routes>
      </BrowserRouter>
    </AppErrorBoundary>
  </StrictMode>,
)
