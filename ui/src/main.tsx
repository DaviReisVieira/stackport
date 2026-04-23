import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { TooltipProvider } from '@/components/ui/tooltip'
import { Toaster } from '@/components/ui/sonner'
import { EndpointProvider } from '@/contexts/EndpointContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/">
      <EndpointProvider>
        <TooltipProvider>
          <App />
          <Toaster richColors />
        </TooltipProvider>
      </EndpointProvider>
    </BrowserRouter>
  </StrictMode>,
)
