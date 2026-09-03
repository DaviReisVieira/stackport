import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Toaster } from 'sonner'
import { EndpointProvider } from '@/contexts/EndpointContext'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename="/">
      <EndpointProvider>
        <App />
        <Toaster richColors />
      </EndpointProvider>
    </BrowserRouter>
  </StrictMode>,
)
