import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate, useParams } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'

const CloudscapeDashboard = lazy(() => import('./pages/CloudscapeDashboard'))
const CloudscapeResourceBrowser = lazy(() => import('./pages/CloudscapeResourceBrowser'))
const CloudscapeSettings = lazy(() => import('./pages/CloudscapeSettings'))
const CloudscapeAbout = lazy(() => import('./pages/CloudscapeAbout'))

function pageFallback() {
  return <div className="p-6 text-sm opacity-70">Loading…</div>
}

export default function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={pageFallback()}>
        <Routes>
          <Route path="/" element={<CloudscapeDashboard />} />
          <Route path="/resources" element={<CloudscapeResourceBrowser />} />
          <Route path="/resources/:service" element={<CloudscapeResourceBrowser />} />
          <Route path="/settings" element={<CloudscapeSettings />} />
          <Route path="/about" element={<CloudscapeAbout />} />
          {/* Old parallel-migration routes redirect to their final homes */}
          <Route path="/cloudscape" element={<Navigate to="/" replace />} />
          <Route path="/cloudscape/resources" element={<Navigate to="/resources" replace />} />
          <Route path="/cloudscape/resources/:service" element={<CloudscapeRedirect />} />
          <Route path="/cloudscape/settings" element={<Navigate to="/settings" replace />} />
          <Route path="/cloudscape/about" element={<Navigate to="/about" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </ErrorBoundary>
  )
}

function CloudscapeRedirect() {
  const { service } = useParams<{ service: string }>()
  return <Navigate to={`/resources/${service}`} replace />
}
