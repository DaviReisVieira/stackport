import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { EndpointProvider } from '@/contexts/EndpointContext'
import { LearnProvider } from '@/contexts/LearnContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/">
      <EndpointProvider>
        {/* Above App on purpose: every page renders its own shell, so a
            shell-level AnnotationContext would reset the tutorial on each
            navigation and no lesson could cross pages. */}
        <LearnProvider>
          <App />
          <Toaster richColors />
        </LearnProvider>
      </EndpointProvider>
    </BrowserRouter>
  </StrictMode>,
)
