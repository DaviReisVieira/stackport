import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import Dashboard from './pages/Dashboard'
import ResourceBrowser from './pages/ResourceBrowser'
import About from './pages/About'
import Settings from './pages/Settings'
import { Skeleton } from './components/ui/skeleton'

const CloudscapeDashboard = lazy(() => import('./pages/CloudscapeDashboard'))
const CloudscapeResourceBrowser = lazy(() => import('./pages/CloudscapeResourceBrowser'))

function MainApp() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/resources" element={<ResourceBrowser />} />
        <Route path="/resources/:service" element={<ResourceBrowser />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/about" element={<About />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        {/* Cloudscape spike renders standalone (its own AppLayout shell), outside the current Layout */}
        <Route
          path="/cloudscape"
          element={
            <Suspense fallback={<div className="p-6"><Skeleton className="h-64 w-full" /></div>}>
              <CloudscapeDashboard />
            </Suspense>
          }
        />
        <Route
          path="/cloudscape/resources"
          element={
            <Suspense fallback={<div className="p-6"><Skeleton className="h-64 w-full" /></div>}>
              <CloudscapeResourceBrowser />
            </Suspense>
          }
        />
        <Route
          path="/cloudscape/resources/:service"
          element={
            <Suspense fallback={<div className="p-6"><Skeleton className="h-64 w-full" /></div>}>
              <CloudscapeResourceBrowser />
            </Suspense>
          }
        />
        <Route path="*" element={<MainApp />} />
      </Routes>
    </ErrorBoundary>
  )
}
